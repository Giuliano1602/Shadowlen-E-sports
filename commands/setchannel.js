const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const configPath = path.join(__dirname, "..", "data", "config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set the channel for daily Rocket League shop posts")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Target text channel")
        .setRequired(true)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel("channel", true);

    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      config = {};
    }

    config.channelId = channel.id;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    await interaction.reply({
      content: `Shop channel set to ${channel}`,
      ephemeral: true
    });
  }
};
