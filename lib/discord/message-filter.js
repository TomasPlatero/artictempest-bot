function shouldForwardAbsenceMessage(message, absenceChannelId) {
  return !message.author.bot && message.channelId === absenceChannelId;
}

module.exports = {
  shouldForwardAbsenceMessage,
};
