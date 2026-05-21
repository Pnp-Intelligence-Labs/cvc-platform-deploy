"""
core/pnpbert/engine.py — PnPbert scoring engine.

Multi-vector late interaction recommendation model.
Each entity is represented as a set of semantic facet vectors rather than
a single embedding. Relevance is scored with MaxSim:

    score(Q, D) = Σ_i  max_j  cosine(q_i, d_j)

This lets each user-interest vector independently find its strongest
match across all document facets, producing finer-grained rankings than
a single dot product.

Encoding uses sentence-transformers (all-MiniLM-L6-v2) when available;
falls back to a pure-numpy TF-IDF encoder that fits on the query corpus
at inference time.
"""
import math
import re
from collections import Counter
from typing import Optional

import numpy as np


class PnPbert:
    def __init__(self) -> None:
        self._encoder = None       # None = untried, "unavailable" = no sentence-transformers
        self._vocab: dict[str, int] = {}
        self._idf: np.ndarray = np.array([])

    # ------------------------------------------------------------------
    # Encoder selection
    # ------------------------------------------------------------------

    def _try_load_encoder(self) -> bool:
        if self._encoder is not None:
            return self._encoder != "unavailable"
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
            self._encoder = SentenceTransformer("all-MiniLM-L6-v2")
            return True
        except Exception:
            self._encoder = "unavailable"
            return False

    # ------------------------------------------------------------------
    # TF-IDF fallback encoder (pure numpy, no external deps)
    # ------------------------------------------------------------------

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        return re.findall(r"\b[a-z]{2,}\b", text.lower())

    def _fit_tfidf(self, corpus: list[str]) -> None:
        N = len(corpus)
        df: Counter = Counter()
        for doc in corpus:
            df.update(set(self._tokenize(doc)))
        vocab = {t: i for i, t in enumerate(sorted(t for t, c in df.items() if c >= 1))}
        self._vocab = vocab
        idf = np.zeros(len(vocab))
        for term, idx in vocab.items():
            idf[idx] = math.log((N + 1) / (df[term] + 1)) + 1.0
        self._idf = idf

    def _tfidf_encode(self, texts: list[str]) -> np.ndarray:
        V = len(self._vocab)
        if V == 0:
            return np.zeros((len(texts), 1))
        matrix = np.zeros((len(texts), V))
        for i, text in enumerate(texts):
            tokens = self._tokenize(text)
            if not tokens:
                continue
            tf = Counter(tokens)
            for term, count in tf.items():
                if term in self._vocab:
                    j = self._vocab[term]
                    matrix[i, j] = (count / len(tokens)) * self._idf[j]
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return matrix / norms

    # ------------------------------------------------------------------
    # Core scoring
    # ------------------------------------------------------------------

    def maxsim(self, Q: np.ndarray, D: np.ndarray) -> float:
        """
        MaxSim late interaction score.
        Q: (q, dim) — query (user) vectors, L2-normalised
        D: (d, dim) — document (startup/news) vectors, L2-normalised
        Returns sum over query vectors of their max cosine similarity to any doc vector.
        """
        if Q.shape[0] == 0 or D.shape[0] == 0:
            return 0.0
        sims = Q @ D.T          # (q, d) cosine similarities (vectors already normalised)
        return float(sims.max(axis=1).sum())

    def rank(
        self,
        query_texts: list[str],
        documents: list[list[str]],
        ids: Optional[list] = None,
    ) -> list[tuple]:
        """
        Rank documents against a multi-text query using MaxSim.

        Args:
            query_texts: list of strings representing user interest facets
            documents:   list of per-document string lists (each doc is multiple facets)
            ids:         optional identifiers aligned with documents

        Returns:
            List of (score, id_or_index) sorted descending by score.
        """
        if not query_texts or not documents:
            return []

        # Flatten everything into one list for a single encode call
        all_texts: list[str] = list(query_texts)
        doc_starts: list[int] = []
        doc_lengths: list[int] = []
        for doc in documents:
            doc_starts.append(len(all_texts))
            doc_lengths.append(len(doc))
            all_texts.extend(doc)

        if self._try_load_encoder():
            encoded = np.array(self._encoder.encode(  # type: ignore[union-attr]
                all_texts, normalize_embeddings=True, show_progress_bar=False
            ))
        else:
            self._fit_tfidf(all_texts)
            encoded = self._tfidf_encode(all_texts)

        Q = encoded[: len(query_texts)]

        scored: list[tuple] = []
        for i, (start, length) in enumerate(zip(doc_starts, doc_lengths)):
            D = encoded[start : start + length]
            s = self.maxsim(Q, D)
            scored.append((s, ids[i] if ids is not None else i))

        scored.sort(key=lambda x: x[0], reverse=True)
        return scored
