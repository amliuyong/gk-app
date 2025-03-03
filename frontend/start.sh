#!/bin/sh

# Generate env-config.js with runtime environment variables
cat <<EOF > ./public/env-config.js
window.ENV = {
  NEXT_PUBLIC_WS_URL: '${NEXT_PUBLIC_WS_URL}'
};
EOF

# Start the Next.js application
node server.js