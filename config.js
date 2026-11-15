// Public config. Browser login data and download secrets never go in this file.
// The private Tailscale hostname is only accessible inside your own tailnet.
// On the iPhone, open https://<your-PC>.<your-tailnet>.ts.net/personal/
const MEDIAFLOW_LOCAL_HOST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const MEDIAFLOW_TAILNET_HOST = window.location.hostname.toLowerCase().endsWith('.ts.net');
window.MEDIAFLOW_API_BASE = MEDIAFLOW_TAILNET_HOST
  ? window.location.origin
  : (MEDIAFLOW_LOCAL_HOST ? 'http://127.0.0.1:8000' : 'https://mediaflow-api-vwin.onrender.com');
window.MEDIAFLOW_PRIVATE_BETA = !(MEDIAFLOW_LOCAL_HOST || MEDIAFLOW_TAILNET_HOST);
window.MEDIAFLOW_IS_LOCAL = MEDIAFLOW_LOCAL_HOST || MEDIAFLOW_TAILNET_HOST;
