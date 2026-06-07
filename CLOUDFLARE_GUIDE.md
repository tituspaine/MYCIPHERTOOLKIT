# Cloudflare Deployment Guide

To run this forever via Cloudflare:

1. **Environment:** Deploy this code to your VPS/Server using `docker-compose up -d`.
2. **Cloudflare Zero Trust:**
   - Go to Cloudflare Dashboard > Access > Tunnels.
   - Create a new Tunnel named `AutoLaunch`.
   - Install the connector on your server.
   - Point your domain (e.g., `build.yourdomain.com`) to `http://localhost:3000`.
3. **WebSocket Support:**
   - Under Cloudflare Network settings, ensure **WebSockets** is toggled ON.
4. **Limits:**
   - Set the Proxy Timeout to 300 seconds to allow for large Rust/C++ compilations.
