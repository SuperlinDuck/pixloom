FROM node:24-bookworm-slim
WORKDIR /opt/pixloom/template
COPY template/package.json template/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY template/ ./
WORKDIR /opt/pixloom
COPY file-tools.cjs control.cjs preview-server.cjs ./
RUN chown -R root:root /opt/pixloom && chmod -R a-w /opt/pixloom
USER node
WORKDIR /workspace
ENV NODE_ENV=development
CMD ["node", "/opt/pixloom/preview-server.cjs"]
