
FROM node:20-slim
WORKDIR /app
COPY . .
RUN mkdir -p modules public data && \
    cp -f database.js modules/ && \
    cp -f classifier.js modules/ && \
    cp -f keywords.js modules/ && \
    cp -f logger.js modules/ && \
    cp -f notifier.js modules/ && \
    cp -f scanner.js modules/ && \
    cp -f scheduler.js modules/ && \
    cp -f scraper-google.js modules/ && \
    cp -f scraper-reclameaqui-2.js modules/scraper-reclameaqui.js && \
    cp -f pdf-report-9.js modules/pdf-report.js && \
    cp -f index-7.html public/index.html && \
    cp -f manifest.json public/
RUN npm install --production
EXPOSE 3000
CMD ["node", "server.js"]
