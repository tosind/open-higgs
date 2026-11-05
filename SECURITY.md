# Security

Open Higgs is an early local application. Keep the studio on loopback unless you deliberately deploy it behind authentication. The Kaggle bridge is a separate set of token-authenticated worker routes; the setup guide includes a proxy configuration that exposes only those routes.

Do not put API keys, worker tokens, signed provider URLs, private media, runtime databases or model weights into issues, pull requests or public logs. Rotate a credential if it is accidentally disclosed. `.env`, `data/` and `work/` are ignored and excluded from release packages.

Report security issues through the repository's private vulnerability reporting feature when available. If it is unavailable, open a public issue containing only a brief request for a private reporting channel, without exploit details or secrets. Do not test an exploit against another person's studio or provider account.

There is no published response-time or long-term support guarantee. Reports should include the affected version, a minimal reproduction using non-private fixtures, and the impact.
