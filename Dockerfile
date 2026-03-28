
FROM node:20-slim
WORKDIR /app
COPY . .
RUN mkdir -p modules public data && \
    mv database.js classifier.js keywords.js logger.js \
       notifier.js pdf-report.js scanner.js scheduler.js \
       scraper-google.js scraper-reclameaqui.js modules/ && \
    mv index.html manifest.json public/
RUN npm install --production
EXPOSE 3000
CMD ["node", "server.js"]
