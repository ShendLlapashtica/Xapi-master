// Partial shape of a GET /2/tweets/search/recent response — only the fields
// this pipeline actually reads (expansions=referenced_tweets.id,author_id,
// tweet.fields=entities,created_at).

export interface XUrlEntity {
  url: string;
  expanded_url: string;
  display_url?: string;
}

export interface XReferencedTweet {
  type: "retweeted" | "quoted" | "replied_to";
  id: string;
}

export interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  entities?: { urls?: XUrlEntity[] };
  referenced_tweets?: XReferencedTweet[];
}

export interface XUser {
  id: string;
  username: string;
  name?: string;
}

export interface XSearchResponse {
  data?: XTweet[];
  includes?: {
    tweets?: XTweet[];
    users?: XUser[];
  };
  meta: {
    newest_id?: string;
    oldest_id?: string;
    result_count: number;
    next_token?: string;
  };
}
