const Sequelize = require('sequelize');
const database = require('./db');

const Programs = database.define('programs', {
    id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        allowNull: false,
        primaryKey: true
    },
    url: {
        type: Sequelize.STRING,
        allowNull: false
    },
    index: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    state: {
        type: Sequelize.INTEGER,
        allowNull: false
    },
    video_ids: {
        type: Sequelize.TEXT,
        allowNull: false
    },
    tag: {
        type: Sequelize.STRING,
        allowNull: true
    },
});

module.exports = Programs;
