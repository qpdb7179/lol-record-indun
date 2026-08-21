require('dotenv').config();
const express = require('express');
const path = require('path');
const { getChampionList } = require('./lib/dataDragon');
const playersRouter = require('./routes/players');
const seriesRouter = require('./routes/series');
const statsRouter = require('./routes/stats');
const visionRouter = require('./routes/vision');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' })); // 점수판 스크린샷을 base64 JSON으로 받아서 기본 100kb로는 부족함
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
app.use('/api/vision', visionRouter);

app.listen(PORT, () => {
  console.log(`lol-record-indun listening on :${PORT}`);
});
