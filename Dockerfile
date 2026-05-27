FROM node:20-alpine

WORKDIR /app

COPY package.json README.md ./
COPY src ./src

RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /logs /reports /data /state \
  && chown -R app:app /app /logs /reports /data /state

USER app

EXPOSE 8080 8090

ENTRYPOINT ["node", "/app/src/cli.js"]
CMD ["server"]
