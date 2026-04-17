const express = require("express");
const cors = require("cors");
const { Firestore } = require("@google-cloud/firestore");

const app = express();
app.use(cors());
app.use(express.json());

const db = new Firestore({ projectId: "csc323-final" });

app.get("/parts", async (req, res) => {
  try {
    const { category, search } = req.query;

    let q = db.collection("parts").where("inStock", "==", true);
    if (category) q = q.where("partType", "==", category);
    q = q.orderBy("price", "asc").limit(100);

    const snap = await q.get();
    let parts = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    if (search) {
      const s = search.toLowerCase();
      parts = parts.filter((p) => p.name?.toLowerCase().includes(s));
    }

    res.json({ parts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`parts-api listening on ${PORT}`));
