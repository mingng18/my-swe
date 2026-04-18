## 2024-05-24 - SSRF in multimodal utilities
**Vulnerability:** fetchImageBlock failed to mitigate SSRF when downloading external images
**Learning:** An attacker could supply internal loopback IPs or metadata IP addresses (e.g. 127.0.0.1, 169.254.x.x) which the server would fetch.
**Prevention:** Always validate protocols using URL constructor and use DNS lookup to resolve the actual IP address, explicitly blocking local, private, and metadata IP ranges.
