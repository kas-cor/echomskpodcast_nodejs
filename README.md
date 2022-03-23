## Канал в телеграмм [@echomskpodcast](https://t.me/echomskpodcast)

Скрипт для получение аудио с YouTube каналов и отправки его в канал через бота.

### Установка

```bash
cp .env.sample .env
npm install
```

Изменить файл `.env` вписать имя канала начиная с @ и токен бота добавленного в канал как администратор. 

### Использование

#### Вызов справки

```bash
node main.js help
```

#### Список rss

```bash
node main.js list
```

#### Добавление rss

```bash
node main.js add https://www.youtube.com/feeds/videos.xml?channel_id=...
```

или

```bash
node main.js add https://www.youtube.com/feeds/videos.xml?channel_id=...|https://www.youtube.com/feeds/videos.xml?channel_id=...
```

#### Удаление rss

```bash
node main.js remove {id}
```

#### Сброс статусов

```bash
node main.js reset
```

#### Назначение тега

```bash
node main.js tag {id} {tagName}
```

#### Запуск скрипта

```bash
node main.js
```

или

```bash
npm run start
```
