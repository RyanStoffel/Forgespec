const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
app.use(express.json());

app.post("/builds", (req, res) => {
  const buildId = randomUUID();
  res.status(202).json({
    buildId,
    status: "Processing",
    message: "Build accepted for analysis",
  });
});

app.get("/builds/:buildId", (req, res) => {
  res.json({ buildId: req.params.buildId, message: "build-api stub" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`build-api listening on ${PORT}`));
