# Local stdio MCP server, using the same package as the official Registry.
# No repository files, credentials, or session logs are copied into the image.
FROM node:22-bookworm-slim

RUN npm install --global --ignore-scripts --no-audit --no-fund thoughtdag@0.2.2 \
    && npm cache clean --force

ENV THOUGHTDAG_HOME=/home/node/.thoughtdag \
    THOUGHTDAG_SESSION_ROOTS=/data/sessions \
    THOUGHTDAG_CANVAS_ROOTS=/data/canvases \
    THOUGHTDAG_MEMORY_ROOTS=""

USER node
WORKDIR /home/node
ENTRYPOINT ["thoughtdag"]
CMD ["mcp"]
