FROM node:current-alpine3.16

RUN apk add --no-cache youtube-dl ffmpeg
RUN echo '* * * * * cd /app && node main.js' > /etc/crontabs/root

WORKDIR /app

COPY . .

RUN npm install

CMD crond -l 2 -f
