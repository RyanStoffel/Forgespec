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
    // Order by sortPrice — it has a sentinel value (1e9) for null-priced parts
    // so they sort to the end. Ordering by `price` puts NULLs first which
    // would push real parts past the limit. Index: partType + inStock + sortPrice.
    q = q.orderBy("sortPrice", "asc").limit(200);

    const snap = await q.get();
    // Defensive filter: drop parts without a real positive price.
    let parts = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((p) => typeof p.price === "number" && p.price > 0);

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
