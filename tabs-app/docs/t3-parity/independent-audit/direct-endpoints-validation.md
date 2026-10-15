# Direct endpoint discovery

Batch330: Complete143-line source and207-line tests reviewed;8 tests passed1.17s/exit0. Loopback excluded, wildcard filtered numeric private/tailnet IPv4, virtual interfaces skipped and duplicate addresses removed. Hostnames/public/IPv6 omitted deliberately. LAN determination uses configured bind/port and OS interface list, not a live listener probe. Tailscale discovery wrapped3-second timeout/error fallback preserves initial LAN list statically; tests do not exercise timeout.

Comment claims Serve answers as this server. Actual helper packages/tailscale/src/tailscale.ts368–384 checks only2xx from /.well-known/t3/environment; it never decodes descriptor or matches environment ID. Existing mock200 body is empty and still advertises URL. This proves reachability-only verification, not identity. Wrong Serve routing impact requires client/environment verification trace before severity. No actual tailscale/native network calls in tests.

Batch331 consumer search: apps/packages TS/TSX references only contract and ws.ts producer; no client consumer found. Automatic route/credential impact not established.
