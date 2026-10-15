# Preview public SOCKS proxy

Batch339: Complete244-line source and186-line tests reviewed. Native loopback SOCKS tests focused exit0. Refuses private/own addresses, mapped and NAT64/6to4/Teredo forms; DNS resolves all then refuses any local, connects with checked lookup to avoid second DNS resolution. Scope destroys tracked sockets and closes listener; listen error handled. All public ports except0 accepted deliberately byte transport.

No per-client handshake/DNS/connect timeout or socket count cap; early data64KiB cap checks later chunks, not initial request.rest. Conditional resource risk not reproduced. Rejected greeting end has no destroy callback, unlike request refusal. Test suite covers refusal variants/own interface address/listen failure/scope close; no successful forwarding, mixed DNS answers/rebinding or public TLS behavior. Full headlessChrome flags/network bypass behavior remains separate source review.
