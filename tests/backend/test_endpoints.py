import importlib.util
from pathlib import Path
import socket
import sys
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request


MODULE_PATH = Path(__file__).parents[2] / "server" / "judge-m-control-plane" / "semantic_routing.py"
SPEC = importlib.util.spec_from_file_location("hermes_semantic_routing_endpoints", MODULE_PATH)
semantic_routing = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = semantic_routing
SPEC.loader.exec_module(semantic_routing)


class EndpointValidationTests(TestCase):
    def test_explicit_private_and_loopback_addresses_remain_allowed(self):
        for endpoint in (
            "http://127.0.0.1:11434/v1",
            "http://10.0.0.8:8080/v1",
            "http://[::1]:8080/v1",
            "http://[::ffff:127.0.0.1]:8080/v1",
        ):
            with self.subTest(endpoint=endpoint):
                semantic_routing._validate_custom_endpoint(endpoint)

    def test_local_names_never_allow_mapped_metadata_or_link_local_addresses(self):
        targets = (
            "::ffff:169.254.169.254",
            "::ffff:100.100.100.200",
            "fe80::1",
            "fd00:ec2::254",
        )
        for target in targets:
            with self.subTest(target=target), patch.object(
                semantic_routing.socket,
                "getaddrinfo",
                return_value=[(socket.AF_INET6, socket.SOCK_STREAM, 6, "", (target, 80, 0, 0))],
            ):
                with self.assertRaises(ValueError):
                    semantic_routing._validate_custom_endpoint("http://localhost:80/v1")

    def test_non_local_hostname_resolving_private_is_rejected(self):
        with patch.object(
            semantic_routing.socket,
            "getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 443))],
        ):
            with self.assertRaises(ValueError):
                semantic_routing._validate_custom_endpoint("https://router.example/v1")

    def test_validation_returns_the_single_pinned_address(self):
        result = [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::ffff:8.8.8.8", 443, 0, 0))]
        with patch.object(semantic_routing.socket, "getaddrinfo", return_value=result) as resolver:
            parsed, pinned = semantic_routing._validated_endpoint("https://router.example/v1")
        resolver.assert_called_once_with("router.example", 443, type=socket.SOCK_STREAM)
        self.assertEqual(parsed.hostname, "router.example")
        self.assertEqual(pinned, "8.8.8.8")


class PinnedTransportTests(TestCase):
    def test_https_handler_constructs_a_pinned_connection_on_python_312(self):
        handler = semantic_routing._PinnedHTTPSHandler("8.8.8.8")
        handler.do_open = lambda factory, request, **kwargs: factory(request.host, **kwargs)

        connection = handler.https_open(Request("https://router.example/v1/decisions"))

        self.assertIsInstance(connection, semantic_routing._PinnedHTTPSConnection)
        self.assertEqual(connection._pinned_address, "8.8.8.8")
        self.assertEqual(connection.host, "router.example")
        self.assertTrue(connection._context.check_hostname)

    def test_http_connection_uses_pinned_address(self):
        connection = semantic_routing._PinnedHTTPConnection("router.example", "127.0.0.1", timeout=7)
        calls = []
        connection._create_connection = lambda *args: calls.append(args) or object()

        connection.connect()

        self.assertEqual(calls, [(('127.0.0.1', 80), 7, None)])

    def test_https_connection_uses_pinned_address_and_url_host_for_sni(self):
        context = SimpleNamespace(wrap_socket=lambda sock, server_hostname: (sock, server_hostname))
        connection = semantic_routing._PinnedHTTPSConnection(
            "router.example", "127.0.0.1", timeout=7, context=context
        )
        calls = []
        connection._create_connection = lambda *args: calls.append(args) or object()

        connection.connect()

        self.assertEqual(calls, [(('127.0.0.1', 443), 7, None)])
        self.assertEqual(connection.sock[1], "router.example")

    def test_redirect_handler_rejects_redirects(self):
        with self.assertRaises(URLError):
            semantic_routing._RejectRedirects().redirect_request(
                Request("https://router.example/v1/decisions"), None, 302, "Found", {},
                "https://other.example/v1/decisions",
            )

    def test_system_one_passes_configured_timeout_to_pinned_opener(self):
        response = SimpleNamespace(
            read=lambda: b'{"selected": "openai/gpt-test"}',
            __enter__=lambda self: self,
            __exit__=lambda self, exc_type, exc, tb: None,
        )
        class ContextManager:
            def __enter__(self):
                return response

            def __exit__(self, exc_type, exc, tb):
                return None

        opener = SimpleNamespace()

        def open_request(request, timeout):
            self.assertIsInstance(request, Request)
            self.assertEqual(timeout, 13)
            return ContextManager()

        opener.open = open_request
        cfg = {
            "decision_model": {"endpoint": "http://127.0.0.1:8080/v1/decisions", "model": "judge"},
            "policy": "balanced",
            "timeout_seconds": 13,
        }
        candidates = [semantic_routing.Candidate("openai", "gpt-test")]
        with patch.object(
            semantic_routing,
            "_validated_endpoint",
            return_value=(urlparse(cfg["decision_model"]["endpoint"]), "127.0.0.1"),
        ) as validator, patch.object(
            semantic_routing, "_decision_opener", return_value=opener
        ) as opener_factory:
            selected, confidence, ordered = semantic_routing._system_one_decision(
                cfg, "choose a model", candidates
            )

        validator.assert_called_once()
        opener_factory.assert_called_once_with("127.0.0.1")
        self.assertEqual(selected, "openai/gpt-test")
        self.assertIsNone(confidence)
        self.assertEqual(ordered, [])
