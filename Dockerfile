FROM node:current-alpine3.16

RUN apk add --no-cache ffmpeg wget

RUN echo '*/5 * * * * cd /app && node main.js' > /etc/crontabs/root

WORKDIR /app

COPY . .

RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -O ./yt-dlp && chmod +x ./yt-dlp

RUN npm update

CMD crond -l 2 -f
