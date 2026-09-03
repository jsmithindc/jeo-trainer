/**
 * Fisher–Yates. Returns a new array; the input is untouched.
 *
 * The three call sites here all used `sort(() => Math.random() - 0.5)`, which is not a
 * shuffle: comparison sorts assume a consistent comparator, and a random one leaves the
 * result measurably biased towards the original order — items near the front tend to
 * stay near the front. For a study session that means the same cards keep coming up
 * first, which is the one thing a shuffle exists to prevent.
 */
export function shuffled(items) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
