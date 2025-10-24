// keep_alive.js
const express = require('express');
const app = express();
const port = process.env.PORT || 3000; 

function keep_alive() {
  // සරල HTTP Request එකකට ප්‍රතිචාර දැක්වීම
  app.get('/', (req, res) => {
    res.send('WhatsApp Bot is Alive and Running 24/7! 🟢');
  });

  // Server එක පටන් ගැනීම
  app.listen(port, () => {
    console.log(`Keep-Alive server listening on port ${port}`);
  });
}

module.exports = keep_alive;
