## Канал в телеграмм [@echomskpodcast](https://t.me/echomskpodcast)

Скрипт для получение mp3 файла подкаста с сайта ЭхоМосквы и отправки его в канал через бота.

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

#### Список rss подкастов

```bash
node main.js list
```

#### Добавление rss подкаста

```bash
node main.js add https://echo.msk.ru/programs/...
```

#### Удаление rss подкаста

```bash
node main.js remove {id}
```

#### Запуск скрипта

```bash
node main.js
```

или

```bash
npm run start
```
