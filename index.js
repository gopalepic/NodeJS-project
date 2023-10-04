const express = require('express');
const fetch = require('node-fetch');
const load = require('lodash');

const app = express();
const PORT = process.env.PORT || 3000;

let lastFetchTime = null;

// in s
const ttl = 5;

const memoizedBlogStatsMiddleware = load.memoize(async () => {
  console.log('Fetching blog stats');

  const apiUrl = 'https://intent-kit-16.hasura.app/api/rest/blogs';
  const secret =
    '32qR4KmXOIpsGPQKMqEJHGJS27G5s7HdSKO3gdtQd2kv5e852SiYwWNfxkZOBuQ6';

  try {
    const response = await fetch(apiUrl, {
      headers: { 'x-hasura-admin-secret': secret },
    });

    const blogData = await response.json();

    lastFetchTime = new Date().getTime();

    return blogData.blogs;
  } catch (error) {
    console.error(error);

    return error;
  }
});

app.use(async (req, res, next) => {
  if (lastFetchTime && new Date().getTime() - lastFetchTime > ttl * 1000) {
    memoizedBlogStatsMiddleware.cache.clear();
  }

  const blogs = await memoizedBlogStatsMiddleware();

  if (blogs instanceof Error) {
    return res.status(500).json({ error: 'Internal server error' });
  }

  res.locals.blogs = blogs;

  next();
});

app.get('/api/blog-stats', async (req, res) => {
  const { blogs } = res.locals;

  const totalBlogs = blogs.length;
  const longestTitleBlog = load.maxBy(blogs, 'title.length');
  const blogsWithPrivacy = load.filter(blogs, (blog) =>
    load.includes(load.toLower(blog.title), 'privacy')
  );
  const uniqueTitles = load.uniqBy(blogs, 'title');

  res.json({
    totalBlogs,
    titleOfLongestBlog: longestTitleBlog.title,
    numberOfBlogsWithPrivacy: blogsWithPrivacy.length,
    uniqueBlogTitles: uniqueTitles.map((blog) => blog.title),
  });
});

const searchCache = new Map();

app.get('/api/blog-search', (req, res) => {
  const query = req.query.query;

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  const { blogs } = res.locals;

  if (searchCache.has(query)) {
    console.log('Serving from cache');

    const queryBody = searchCache.get(query);

    if (
      queryBody &&
      queryBody.fetchAt + ttl * 2 * 1000 > new Date().getTime()
    ) {
      return res.json(queryBody.data);
    } else {
      searchCache.delete(query);
    }
  }

  console.log("Serving from server's memory");

  /**
   * Not required to cache this but cached assuming that
   * this is a heavy operation
   */
  const matchingBlogs = blogs.filter((blog) =>
    blog.title.toLowerCase().includes(query.toLowerCase())
  );

  searchCache.set(query, {
    fetchAt: new Date().getTime(),
    data: matchingBlogs,
  });

  res.json(matchingBlogs);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
