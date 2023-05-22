import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import Knex from 'knex'
import { fileURLToPath } from 'node:url'

const knex = Knex({
  client: "better-sqlite3",
  connection: {
    filename: fileURLToPath(new URL("./app.db", import.meta.url)),
  },
  useNullAsDefault: true,
})

if (!await knex.schema.hasTable("tasks")) {
  await knex.schema.createTable("tasks", t => {
    t.increments("id").primary()
    t.integer("chat_id").notNullable()
    t.text("cron").notNullable()
    t.text("msg").notNullable();
    t.text("caption").nullable();
    t.text("msg_type").notNullable();
    t.timestamps({
      useTimestamps: true,
      defaultToNow: true,
    })
  })
}

const Task = () => knex("tasks")

const token = process.env.TG_BOT_TOKEN
const username = process.env.TG_BOT_USERNAME || "@replaymsgbot";

if (token == null || typeof token !== 'string') {
  throw new TypeError("TG_BOT_TOKEN == null")
}

const bot = new Telegraf(token)


// register tasks
const tasks = await Task()

for (const task of tasks) {
  registerPayload(task)
}

function registerPayload(task) {
  console.log('register ' + task.id)
  cron.schedule(task.cron, async () => {

    if (task.msg_type === 'file') {
      await bot.telegram.sendDocument(task.chat_id, task.msg, {
        caption: task.caption
      })
      return
    }

    await bot.telegram.sendMessage(task.chat_id, task.msg);
  }, {
    timezone: "Asia/Bangkok"
  })
}

bot.start(ctx => ctx.reply("Hello from Message Replay! 👋"))
bot.command("replay", async (ctx) => {

  const roomId = ctx.chat.id;
  const replayMessage = ctx.message.reply_to_message;
  const COMMAND_REGEX = /^(\/[\w@]+)\s+(.+)/gm;
  const result = COMMAND_REGEX.exec(ctx.message.text)

  let exp = ctx.message.text;

  if (result) {
    exp = exp.slice(result[1].length).trim()
  } else {
    ctx.reply("Couldn't parse the CRON expression.")
    return;
  }

  if (!cron.validate(exp)) {
    ctx.reply("Your CRON expression is invalid")
    return;
  }

  const payload = {
    chat_id: roomId,
    msg: replayMessage.document ? replayMessage.document.file_id : replayMessage.text,
    msg_type: replayMessage.document ? "file" : "text",
    cron: exp,
    caption: replayMessage.caption,
  }

  const tasks = await Task().insert(payload, '*')
  registerPayload(tasks[0])
  
  ctx.reply(`✅ Task ${tasks[0].id} has been added. `);
})

bot.command("tasks", async (ctx) => {
  const tasks = await Task().where('chat_id', ctx.chat.id)
  const str = tasks.map(task => `#${task.id} ${task.caption || task.msg} (${task.msg_type})`).join("\n")
  if (tasks.length === 0) {
    await ctx.reply(`You have no tasks!`);
    return
  }
  await ctx.reply(`List of tasks:\n` + str);
})

bot.command("test", async (ctx) => {

  const text = ctx.message.text;
  const result = /^\/[\w@]+\s+(\d+)/.exec(text)

  if (result && result[1]) {
    const id = parseInt(result[1]);
    const task = await Task()
      .where('chat_id', ctx.chat.id)
      .where('id', id)
      .first()

    if (!task) {
      await ctx.reply('Task not found')
      return
    }

    if (task.msg_type === 'file') {
      await ctx.replyWithDocument(task.msg, { caption: task.caption })
      return
    }

    await ctx.reply(task.msg)
    return;
  }

  await ctx.reply("Invalid arguments")
})

bot.command("clear", async (ctx) => {
  await Task().where('chat_id', ctx.chat.id).delete()
  await ctx.reply("✅ Tasks cleared")
})

bot.command('id', ctx => ctx.reply(`id: ${ctx.chat.id}`))
bot.mention(username, ctx => ctx.reply(`Your id is ${ctx.chat.id}`))
bot.launch()

const killTasks = () => {
  for (const [id, task] of cron.getTasks().entries()) {
    task.stop()
    console.log('kill ' + id)
  }
}

// Enable graceful stop
process.once('SIGINT', () => {
  killTasks();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  killTasks();
  bot.stop('SIGTERM');
});