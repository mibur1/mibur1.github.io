---
title: Multiverse Analysis
summary: Analysing data is important and fun. Why not do it a thousand times?
color: '#0e6a5e'
color_dark: '#3aa899'
thumb: /static/img/multiverse.webp
description: Analysing data is important and fun. Why not do it a thousand times?
---

<p class="badges">
<a class="badge" style="--c:#c2582b" href="https://doi.org/10.1162/IMAG.a.1122"><span class="badge__label">paper</span><span class="badge__value">Imaging Neuroscience</span></a>
<a class="badge" style="--c:#1f6091" href="https://github.com/mibur1/comet"><span class="badge__label">GitHub</span><span class="badge__value">mibur1/comet</span></a>
<a class="badge" style="--c:#0e6a5e" href="https://comet-toolbox.readthedocs.io/en/latest/"><span class="badge__label">docs</span><span class="badge__value">readthedocs</span></a>
</p>

Brain-behaviour analyses involve a long chain of analytical decisions: how to clean the
data, which atlas to parcellate with, how to define brain connectivity, or how to model
the brain-behaviour association itself. Each analytical decision has several defensible 
options, and published papers often report exactly one path through that decision space.
This introduces potential risks, such as results not reproducing well with new data.

One approach to deal with this issue is [multiverse analysis](https://doi.org/10.1177/1745691616658637).
This framework aims to analyse a larger number of defensible analysis pipelines and to report the 
distribution of the resulting effects rather than a single point estimate. This allows researchers to gain a
better understanding for which decisions actually influence the result. 

However, implementing and running hundreds or thousands of analytical pipelines in parallel is a lot of engineering, 
and simply creating many results does not really tell you anything about what to infer from them.
To help researchers with this, we developed the [Comet Toolbox](https://github.com/mibur1/comet), which is a Python 
package pairing a suite of network neuroscience methods with a *method-agnostic multiverse framework*. This multiverse 
module wraps *any* analysis pipeline, so it isn't limited to the methods that ship with the toolbox.

As an example, we showcase a multiverse analysis of a recently published preprint by [Popp et al. (2026)](https://www.biorxiv.org/content/10.64898/2026.01.19.700296v1),
which reports (among other things) that higher neuroticism trait scores go with greater heterogeneity in movie-evoked brain responses. 
We stress-test this finding in a multiverse analysis consisting of almost 2000 analysis pipelines:

<figure class="figure--aside" markdown="1">
<img src="/static/img/multiverse.webp"
     alt="Multiverse plot"
     loading="lazy" decoding="async">
<figcaption>
<b>Multiverse plot</b>
The multiverse plot summarises the results of 1920 analysis pipelines on a single
axis. The upper plot shows the distribution of the results (in this case, the correlation 
between higher neuroticism trait scores and heterogeneity in the brain response).
In the lower plot, each block is one analytical decision, shaded to 
show where the pipelines using each option land, with the mean shift from the reference 
option on the right.
</figcaption>
</figure>

In this figure, it becomes visible that, across all 1920 universes, the effect
stays positive, and it is statistically significant in the majority of them.

One interesting part is which decisions actually matter. For example, how the sibling pairs are split has (expectedly) 
a pretty large influence on the effect. Other decisions like the choice of the brain atlas have a smaller influence, 
but they might still show a trend such as coarser parcellations tending to produce larger effects.

This result can then be used as a starting point for further analyses, such as using the observed patterns to form better 
theories, or to apply integration techniques aiming to integrate the multiverse results into a single answer. Many of these 
extensions are active areas of research.
