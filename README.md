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

#### Список каналов

```bash
node main.js list
```

#### Добавление канала

```bash
node main.js add {channel_id}[|{channel_id}]
```

#### Удаление канала

```bash
node main.js remove {id}
```

#### Назначение тега каналу

```bash
node main.js tag {id} {tagName}
```

#### Сброс всех статусов

```bash
node main.js reset_all_states
```

#### Сброс конкретного статуса

```bash
node main.js reset_state {id}
```

#### Сброс IDs канала

```bash
node main.js reset_ids {id}
```

#### Запуск скрипта

```bash
node main.js
```

или

```bash
npm run start
```

### Запуск в Docker контейнере

```bash
docker-compose up -d
```

#### Исполнение команд

```bash
docker-compose exec echomskpodcast <команда>
```

Например (Список каналов):
```bash
docker-compose exec echomskpodcast node main.js list
```
