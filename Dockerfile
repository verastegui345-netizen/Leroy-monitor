
FROM node:20-slim
WORKDIR /app
COPY . .
RUN mkdir -p modules public data
RUN cp -f database.js classifier.js keywords.js logger.js notifier.js scanner.js scheduler.js scraper-google.js modules/ 2>/dev/null; true
RUN cp -f scraper-reclameaqui-2.js modules/scraper-reclameaqui.js 2>/dev/null; true
RUN cp -f scraper-reclameaqui.js modules/ 2>/dev/null; true
RUN cp -f pdf-report-9.js modules/pdf-report.js 2>/dev/null; true
RUN cp -f pdf-report.js modules/ 2>/dev/null; true
RUN cp -f index-7.html public/index.html 2>/dev/null; true
RUN cp -f index.html public/ 2>/dev/null; true
RUN cp -f manifest.json public/ 2>/dev/null; true
RUN npm install --production
EXPOSE 3000
CMD ["node", "server.js"]
