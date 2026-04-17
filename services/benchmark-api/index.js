const express = require("express");
const app = express();
app.use(express.json());

app.post("/benchmarks", (req, res) => {
  res.status(202).json({ status: "Processing", message: "benchmark-api stub" });
});

app.get("/benchmarks/:benchmarkId", (req, res) => {
  res.json({ benchmarkId: req.params.benchmarkId, message: "benchmark-api stub" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`benchmark-api listening on ${PORT}`));
