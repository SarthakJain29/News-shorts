import { describe, expect, it } from "vitest";
import { parseFeed, stripHtml } from "../pipeline/rss";

describe("parseFeed", () => {
  it("parses RSS 2.0 with CDATA and HTML descriptions", () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>X</title>
      <item><title><![CDATA[Rates held at 4.5%]]></title><link>https://ex.com/a?utm_source=rss</link>
      <description><![CDATA[<p>The bank <b>kept</b> rates &amp; signalled cuts.</p>]]></description>
      <pubDate>Tue, 04 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>No link item</title></item>
    </channel></rss>`;
    const items = parseFeed(xml, "BBC News");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ outlet: "BBC News", title: "Rates held at 4.5%", url: "https://ex.com/a?utm_source=rss", summary: "The bank kept rates & signalled cuts." });
    expect(items[0].publishedAt).toBe("2026-11-04T10:00:00.000Z");
  });

  it("parses Atom entries with alternate links", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom story</title>
      <link rel="alternate" href="https://ex.com/atom"/><updated>2026-11-04T09:00:00Z</updated>
      <summary>Short summary</summary></entry></feed>`;
    expect(parseFeed(xml, "The Verge")[0]).toMatchObject({ title: "Atom story", url: "https://ex.com/atom", summary: "Short summary" });
  });

  it("parses RSS 1.0 (RDF)", () => {
    const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/">
      <item><title>RDF story</title><link>https://dw.com/x</link><dc:date>2026-11-04T08:00:00Z</dc:date></item></rdf:RDF>`;
    expect(parseFeed(xml, "DW")[0]).toMatchObject({ title: "RDF story", url: "https://dw.com/x" });
  });

  it("strips tags and entities", () => {
    expect(stripHtml("<a href='#'>Hi</a>&nbsp;there &#8217;")).toBe("Hi there ’");
  });
});
