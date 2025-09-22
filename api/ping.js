module.exports = (req, res) => {
  res.status(200).json({ ok: true, env: Object.keys(process.env) });
};
