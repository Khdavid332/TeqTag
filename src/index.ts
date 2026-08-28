import 'dotenv/config';
import express from 'express';
import session from 'express-session';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.get('/', (_req, res) => {
  res.send('Test');
});

app.listen(PORT, () => {
  console.log(`Run on: http://127.0.0.1:${PORT}`);
});
