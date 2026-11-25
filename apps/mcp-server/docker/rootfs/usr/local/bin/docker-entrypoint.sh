#!/bin/sh

# --enable-source-maps resolves production stack traces back to original TypeScript source.
NODE_OPTIONS="--no-node-snapshot --enable-source-maps" INBOXOS_MCP_TRANSPORT=${INBOXOS_MCP_TRANSPORT:-sse} INBOXOS_MCP_HOST=${INBOXOS_MCP_HOST:-0.0.0.0} INBOXOS_MCP_PORT=${INBOXOS_MCP_PORT:-3333} node apps/mcp-server/dist/index.mjs;
