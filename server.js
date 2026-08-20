require('dotenv').config();
const express = require('express');
const path = require('path');
const { getChampionList } = require('./lib/dataDragon');
const playersRouter = require('./routes/players');
const seriesRouter = require('./routes/series');
const statsRouter = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/champions', async (req, res) => {
  try {
    res.json(await getChampionList());
  } catch (err) {
    res.status(502).json({ error: `챔피언 데이터를 불러오지 못했습니다: ${err.message}` });
  }
});

app.use('/api/players', playersRouter);
app.use('/api/series', seriesRouter);
app.use('/api/stats', statsRouter);

app.listen(PORT, () => {
  console.log(`lol-recored-indun listening on :${PORT}`);
});
