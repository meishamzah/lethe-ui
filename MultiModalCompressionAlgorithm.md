## Lethe Multimodal PDF Compression Algorithm

### Core principle
A PDF is not a flat file — it is a structured document where text and images 
are semantically coupled. "As shown in Figure 3" means the surrounding text 
and Figure 3 are one unit of meaning. Compression must respect this coupling.

### Two-track approach

#### Track 1 — Text blocks
- Extract all text content from the PDF using pymupdf (fitz)
- Identify which text sections were actually referenced in the conversation
- User questions act as the filter — same conversational footprint principle
  as image compression
- Text that was never discussed gets dropped entirely
- Text that was discussed gets summarized with highlights around the user's
  specific questions
- Dense unreferenced sections (e.g. bibliography, appendices nobody asked 
  about) are discarded

#### Track 2 — Image blocks within the PDF
- Extract each significant figure, chart, diagram, or photo from the PDF
- Each image is treated as a standalone block — same as an uploaded image
- BUT with additional context: the surrounding text, caption, and section 
  heading from the PDF are passed to the summarizer alongside user queries
- This produces better summaries than standalone image compression because
  the model knows what the figure is about from the document context
- Example: compressing Figure 3 uses its caption "Reaction yield vs 
  temperature", surrounding paragraph text, AND user queries about it

### Relationship preservation
- Track the semantic links between text and images before compression
- When a text block references an image ("as shown in Figure 3"), that 
  link is preserved in the combined summary
- Final compressed output maintains the relationship:
  "Figure 3 showed X (reaction yield peaks at 80°C), which the 
  surrounding text explained as Y, and the user asked about Z"

### Combined compression output
Single unified summary per PDF containing:
- What the document is about (one sentence)
- Text sections that were discussed — summarized with user query highlights
- Image blocks that were discussed — summarized with document context
- Preserved references between text and images

### Tiered compression by engagement level

**Tier 1 — Heavily discussed sections:**
Full detailed summary with user query highlights. Preserves specific 
numbers, findings, arguments, and conclusions that came up in conversation.
No detail dropped if it was referenced by the user.

**Tier 2 — Lightly mentioned sections:**
2-3 sentences capturing the core of the section. Covers what the section 
is about, the central finding or argument, and any key specifics. Enough 
for the model to reason about it meaningfully if referenced later.

**Tier 3 — Never mentioned sections:**
1 sentence maximum. Just the essence of what's there.
Example: "The appendix contains raw experimental data tables for the 
three yield experiments."
Never dropped entirely — model always retains a map of the full document.

### Engagement scoring
- Tier 1: section was directly questioned, quoted, or discussed in detail
- Tier 2: section was mentioned or briefly referenced in passing
- Tier 3: section never appeared in the conversation at all
- Scoring is determined by the semantic scanner — same reference detection 
  used for image compression, applied to text sections instead of image blocks

### Implementation notes
- Library: pymupdf (fitz) for PDF parsing — extracts text blocks and 
  images with position data so we know what's near what
- Text extraction: fitz.open() → page.get_text("blocks") for text,
  page.get_images() for embedded images
- Relationship detection: use bounding box proximity — text within 
  N points of an image is considered related; also parse explicit 
  references ("Figure X", "see above", "as shown")
- Two API calls for compression:
  1. Text track summarizer — conversation + text blocks + user queries
  2. Image track summarizer — each image + surrounding PDF text + user queries
  3. Merge call — combine both summaries into one coherent output
- Token estimation: text tokens from character count / 4, 
  image tokens from tile formula per extracted image

### Two-phase implementation plan
Phase 1 (basic): Upload whole PDF as a native document block, let Claude 
read it natively. No parsing, no separation. Works for most use cases.
Compression falls back to standard summarization of the conversation.

Phase 2 (full algorithm): Implement the two-track multimodal approach 
described above. PDF is parsed, text and images separated, relationship 
graph built, two-track compression applied.

Phase 1 ships with M4. Phase 2 is its own milestone after M5.

### Privacy note for UI
- "Text-based PDFs only — scanned PDFs without embedded text are not supported"
- File size limit: 32MB (Anthropic's limit)
- Page limit: 100 pages (Anthropic's limit)
- Surface these as validation errors before upload, not after