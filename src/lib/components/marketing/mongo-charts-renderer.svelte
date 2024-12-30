<!--
  @component
  Activate MongoDB data charts on the page using the Embedding SDK. A chart can be embedded using a
  `<div>` with the `data-chart-id` attribute along with the optional `data-cache` attribute.
  @example <div data-chart-id="8d4dff93-e7ca-4ccd-a622-e20e8a100197" data-cache="3600" />
  @see https://www.mongodb.com/docs/charts/embedded-chart-options/
-->
<script>
  import ChartsEmbedSDK from '@mongodb-js/charts-embed-dom';
  import { onDestroy, onMount } from 'svelte';
  import { afterNavigate, beforeNavigate } from '$app/navigation';

  let sdk;
  let observer;

  const options = { threshold: 0 };

  const callback = (entries) => {
    entries.forEach((e) => {
      console.log('e', e);

      const container = e.target;
      const { chartId, cache } = /** @type {HTMLElement} */ (container).dataset;
      const _cache = Number(cache);

      const chart = sdk.createChart({
        chartId,
        height: 500,
        // `_cache` can be `undefined`, `0`, `-1` or any positive integer (in hours, not seconds,
        // unlike the `maxDataAge` option.) Default: 24 hours
        // eslint-disable-next-line no-nested-ternary
        maxDataAge: Number.isNaN(_cache) ? 86400 : _cache > 0 ? _cache * 3600 : _cache,
        showAttribution: false,
      });

      chart.render(container);
      observer.unobserve(container);
    });
  };

  onMount(() => {
    observer = new IntersectionObserver(callback, options);
    sdk = new ChartsEmbedSDK({ baseUrl: 'https://charts.mongodb.com/charts-sodium-ejpey' });
  });

  afterNavigate(() => {
    // observing all chart containers on the current page
    document.querySelectorAll('[data-chart-id]').forEach((container) => {
      observer.observe(container);
    });
  });

  beforeNavigate(() => {
    document.querySelectorAll('[data-chart-id]').forEach((container) => {
      observer.unobserve(container);
    });
  });

  onDestroy(() => {
    if (observer) observer.disconnect();
  });
</script>
