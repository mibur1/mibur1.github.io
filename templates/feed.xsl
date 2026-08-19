<?xml version="1.0" encoding="utf-8"?>
<!--
  Browsers stopped rendering RSS natively (Chrome 2012, Firefox 2018), so a raw
  feed looks like a wall of XML. This stylesheet is applied by the browser only:
  feed readers ignore it entirely and still see plain RSS.
-->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="utf-8" indent="yes"/>
  <xsl:template match="/rss/channel">
    <html lang="{{ site.lang }}">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="title"/></title>
        <link rel="stylesheet" href="/static/css/tokens.css"/>
        <link rel="stylesheet" href="/static/css/site.css"/>
      </head>
      <body>
        <div class="grain" aria-hidden="true"></div>
        <header class="site-header">
          <div class="wrap site-header__inner">
            <a class="wordmark" href="/">{{ site.name }}</a>
          </div>
        </header>
        <main id="main">
          <div class="wrap">
            <header class="page-head">
              <h1 class="page-head__title">RSS feed</h1>
              <p class="page-head__sub">
                This is a web feed. Copy this page's address into a feed reader
                and you will be notified of new posts without visiting the site.
                <a href="/blog/">Back to the blog</a>.
              </p>
            </header>
            <ul class="post-list">
              <xsl:for-each select="item">
                <li class="post-item">
                  <span class="post-item__date"><xsl:value-of select="pubDate"/></span>
                  <h2 class="post-item__title">
                    <a href="{link}"><xsl:value-of select="title"/></a>
                  </h2>
                  <p class="post-item__excerpt"><xsl:value-of select="description"/></p>
                </li>
              </xsl:for-each>
            </ul>
          </div>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
