FROM node:current-alpine3.16

RUN apk add --no-cache youtube-dl ffmpeg
RUN echo '*/5 * * * * cd /app && node main.js' > /etc/crontabs/root

WORKDIR /app

COPY . .

RUN npm update

CMD crond -l 2 -f
