# echomskpodcast

Скрипт для автоматического получения аудио с YouTube каналов и публикации его в Telegram канал через бота.

## Описание

`echomskpodcast` - это Node.js скрипт, предназначенный для автоматизации процесса загрузки аудиоконтента с указанных YouTube каналов и его последующей публикации в Telegram канал. Идеально подходит для создания подкастов или аудио-архивов из YouTube-видео.

## Возможности

-   Автоматическая загрузка аудио с YouTube каналов.
-   Публикация аудиофайлов в Telegram канал.
-   Поддержка метаданных (название, исполнитель, обложка).
-   Гибкая настройка через переменные окружения.
-   Управление каналами через CLI-команды (добавление, удаление, список).
-   Сброс статусов и ID видео для повторной обработки.

## Установка

1.  **Клонируйте репозиторий:**

    ```bash
    git clone https://github.com/kas-cor/echomskpodcast.git
    cd echomskpodcast
    ```

2.  **Настройте переменные окружения:**

    Создайте файл `.env` на основе `.env.sample` и заполните его:

    ```bash
    cp .env.sample .env
    ```

    Обязательно укажите `TELEGRAM_BOT_TOKEN` (токен вашего бота, добавленного в канал как администратор) и `TELEGRAM_CHANNEL` (имя вашего канала, начиная с `@`).

3.  **Установите зависимости Node.js:**

    ```bash
    npm install
    ```

4.  **Установите/обновите `yt-dlp`:**

    ```bash
    wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -O ./yt-dlp && chmod +x ./yt-dlp
    ```

5.  **(Опционально) Установка Token PO провайдера (для обхода ограничений YouTube):**

    ```bash
    docker compose up -d -f docker-compose-potoken.yml
    ```

6.  **(Опционально) Установка локального сервера Telegram Bot API:**

    ```bash
    docker compose up -d -f docker-compose-bot-api.yml
    ```

## Использование

Все основные операции выполняются через CLI-команды:

-   **Вызов справки:**

    ```bash
    node main.js help
    ```

-   **Список каналов:**

    ```bash
    node main.js list
    ```

-   **Добавление канала:**

    ```bash
    node main.js add {channel_id}[|{channel_id}]
    ```
    Пример: `node main.js add UC-lHJZR3Gqxm24_Vd_D_EZw`

-   **Удаление канала:**

    ```bash
    node main.js remove {id}
    ```

-   **Назначение тега каналу:**

    ```bash
    node main.js tag {id} {tagName}
    ```

-   **Сброс всех статусов (для повторной обработки всех каналов):**

    ```bash
    node main.js reset_all_states
    ```

-   **Сброс конкретного статуса канала:**

    ```bash
    node main.js reset_state {id}
    ```

-   **Сброс ID видео для канала (позволяет повторно загрузить уже обработанные видео):**

    ```bash
    node main.js reset_ids {id}
    ```

-   **Запуск скрипта (основной цикл обработки):**

    ```bash
    node main.js
    ```
    или с использованием npm скрипта:
    ```bash
    npm run start
    ```

## Запуск в Docker контейнере

Для запуска всего приложения в Docker:

```bash
docker-compose up -d -f docker-compose.yml
```

Для выполнения команд внутри запущенного Docker контейнера:

```bash
docker-compose exec echomskpodcast <команда>
```

Например (Список каналов):

```bash
docker-compose exec echomskpodcast node main.js list
```

## Вклад

Приветствуются любые вклады! Если у вас есть предложения по улучшению, отчеты об ошибках или вы хотите добавить новые функции, пожалуйста, создавайте [Issue](https://github.com/kas-cor/echomskpodcast/issues) или [Pull Request](https://github.com/kas-cor/echomskpodcast/pulls).

## Лицензия

Этот проект распространяется под лицензией MIT. Подробности смотрите в файле `LICENSE` (если он есть) или в `package.json`.