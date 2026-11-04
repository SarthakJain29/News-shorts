import type { TrackId } from "../src/lib/types";

export interface FeedSource {
  outlet: string;
  url: string;
}

/** Reputable outlets with public RSS/Atom feeds, grouped by track. */
export const FEEDS: Record<TrackId, FeedSource[]> = {
  technology: [
    { outlet: "BBC News", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
    { outlet: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
    { outlet: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
    { outlet: "TechCrunch", url: "https://techcrunch.com/feed/" },
    { outlet: "The Guardian", url: "https://www.theguardian.com/uk/technology/rss" },
  ],
  sports: [
    { outlet: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml" },
    { outlet: "ESPN", url: "https://www.espn.com/espn/rss/news" },
    { outlet: "The Guardian", url: "https://www.theguardian.com/uk/sport/rss" },
  ],
  finance: [
    { outlet: "BBC News", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
    { outlet: "NPR", url: "https://feeds.npr.org/1006/rss.xml" },
    { outlet: "The Guardian", url: "https://www.theguardian.com/uk/business/rss" },
    { outlet: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  ],
  politics: [
    { outlet: "BBC News", url: "https://feeds.bbci.co.uk/news/politics/rss.xml" },
    { outlet: "NPR", url: "https://feeds.npr.org/1014/rss.xml" },
    { outlet: "The Guardian", url: "https://www.theguardian.com/politics/rss" },
    { outlet: "Politico", url: "https://rss.politico.com/politics-news.xml" },
    { outlet: "Fox News", url: "https://moxie.foxnews.com/google-publisher/politics.xml" },
  ],
  world: [
    { outlet: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { outlet: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
    { outlet: "NPR", url: "https://feeds.npr.org/1004/rss.xml" },
    { outlet: "The Guardian", url: "https://www.theguardian.com/world/rss" },
    { outlet: "DW", url: "https://rss.dw.com/rdf/rss-en-world" },
  ],
  india: [
    { outlet: "The Hindu", url: "https://www.thehindu.com/news/national/feeder/default.rss" },
    { outlet: "The Indian Express", url: "https://indianexpress.com/section/india/feed/" },
    { outlet: "NDTV", url: "https://feeds.feedburner.com/ndtvnews-india-news" },
    { outlet: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms" },
    { outlet: "BBC News", url: "https://feeds.bbci.co.uk/news/world/asia/india/rss.xml" },
  ],
  science: [
    { outlet: "BBC News", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml" },
    { outlet: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/science.xml" },
    { outlet: "NASA", url: "https://www.nasa.gov/news-release/feed/" },
    { outlet: "The Guardian", url: "https://www.theguardian.com/science/rss" },
    { outlet: "NPR", url: "https://feeds.npr.org/1007/rss.xml" },
  ],
};
