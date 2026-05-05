# Redstone Website Manager

Small WordPress plugin for storing editable property marketing content in one place and exposing it to:

- a WordPress admin settings page
- your theme/template files
- a protected REST endpoint for future dashboard sync
- frontend token replacement using controlled placeholders like `{{rwm:hero_headline}}`
- signed remote updates from the Redstone dashboard
- dashboard-managed field schemas, so the WordPress settings screen can match the fields configured in the Redstone dashboard

## Included fields

- `property_name`
- `hero_headline`
- `hero_subtitle`
- `primary_cta_label`
- `primary_cta_url`
- `secondary_cta_label`
- `secondary_cta_url`
- `banner_eyebrow`
- `banner_headline`
- `banner_body`
- `floorplans_headline`
- `floorplans_body`
- `availability_note`
- `pricing_summary`
- `availability_summary`
- `specials_summary`
- `availability_url`
- `starting_price`
- `price_range`
- `specials_count`
- `floorplan_count`
- `available_unit_count`

## Install

1. Upload the ZIP in WordPress under `Plugins > Add New > Upload Plugin`.
2. Activate `Redstone Website Manager`.
3. Open `Settings > Redstone Website Manager`.
4. Enter values manually for testing.
5. In the same settings page, configure the site key and shared secret used for signed remote publishes.

## Theme usage

Use these helpers anywhere in the theme:

```php
$headline = redstone_website_manager_get('hero_headline');
$subtitle = redstone_website_manager_get('hero_subtitle');
$cta_label = redstone_website_manager_get('primary_cta_label');
$cta_url = redstone_website_manager_get('primary_cta_url');
```

Echo directly in templates:

```php
redstone_website_manager_echo('pricing_summary');
redstone_website_manager_echo('availability_url', 'url');
```

Check if a field exists:

```php
if (redstone_website_manager_has('top_banner_text')) {
    echo esc_html(redstone_website_manager_get('top_banner_text'));
}
```

Get the whole payload:

```php
$content = redstone_website_manager_content();
```

Shortcode:

```text
[redstone_site_content key="hero_headline"]
```

For URL fields:

```text
[redstone_site_content key="primary_cta_url" mode="url"]
```

For a shortcode-rendered button:

```text
[redstone_site_button label_key="primary_cta_label" url_key="primary_cta_url"]
```

## Token format for Salient / builder content

Use this controlled placeholder format:

```text
{{rwm:hero_headline}}
{{rwm:hero_subtitle}}
{{rwm:primary_cta_url}}
```

The plugin replaces tokens in final frontend HTML.

This includes:

- normal text content
- `href` attributes
- `src` attributes
- `action` attributes

For builder URL fields that strip curly braces, the plugin also supports these URL-only forms:

```text
rwm:primary_cta_url
/rwm:primary_cta_url
```

That is especially helpful for Salient button URL inputs that rewrite `{{rwm:...}}` tokens.

Textarea-style content fields also allow safe inline HTML such as:

```html
<strong>Bold text</strong>
<em>Italic text</em>
<br>
```

That means you can store formatted copy in the dashboard for fields like subtitles, banner body copy, and availability notes.

The REST sync endpoint also accepts additional safe field keys beyond the built-in defaults. When the Redstone dashboard includes a `__schema` object in the publish payload, the plugin stores that schema and uses it to render the WordPress admin settings screen. That keeps WordPress aligned with the property-specific fields configured in the dashboard.

If an older publish service sends custom field values without `__schema`, the plugin now infers a temporary "Dashboard Fields" schema from those custom keys. The next schema-aware publish replaces that inferred fallback with the exact dashboard groups and labels.

Examples:

```html
<h1>{{rwm:hero_headline}}</h1>
<p>{{rwm:hero_subtitle}}</p>
<a href="{{rwm:primary_cta_url}}">{{rwm:primary_cta_label}}</a>
```

This is intended for builder-driven workflows like Salient where shortcode support in URL fields is inconsistent.

## REST API

Base route:

```text
/wp-json/redstone-site-manager/v1/content
```

### GET

Public read:

```bash
curl https://thestationatmillrace.com/wp-json/redstone-site-manager/v1/content
```

### POST / PUT / PATCH

Protected write. Supports either:

- an authenticated WordPress admin user with `manage_options`, or
- a signed Redstone dashboard request using the configured site key + shared secret

Example:

```bash
curl -X POST https://thestationatmillrace.com/wp-json/redstone-site-manager/v1/content \
  -u 'api-user:APPLICATION_PASSWORD' \
  -H 'Content-Type: application/json' \
  -d '{
    "property_name": "The Station at Mill Race",
    "hero_headline": "Live steps from the river and campus.",
    "hero_subtitle": "Modern student living with spacious layouts and fast access to what matters.",
    "primary_cta_label": "Schedule a Tour",
    "primary_cta_url": "https://thestationatmillrace.com/contact/"
  }'
```

## Salient child theme notes

This plugin is fine for a Salient child theme, and now supports two implementation paths:

1. Keep the content in this plugin.
2. For Salient builder content, use controlled tokens like:

```text
{{rwm:hero_headline}}
{{rwm:primary_cta_label}}
{{rwm:primary_cta_url}}
{{rwm:pricing_summary}}
{{rwm:availability_summary}}
{{rwm:specials_summary}}
```

3. In child theme templates or hooks, you can still pull values directly with:

```php
redstone_website_manager_get('hero_headline');
redstone_website_manager_get('primary_cta_label');
redstone_website_manager_get_url('primary_cta_url');
```

4. If you are placing content inside Salient text blocks, shortcode still works:

```text
[redstone_site_content key="hero_headline"]
```

5. If Salient button URL / label fields do not evaluate dynamic shortcodes reliably, either:

- use the token format directly in the builder fields, or
- use a text block and render the button with:

```text
[redstone_site_button label_key="primary_cta_label" url_key="primary_cta_url"]
```

The token format is the preferred builder approach for this pilot.

## Notes

- Relative URLs entered in admin are normalized to full site URLs on save.
- Data is stored in a single option: `redstone_website_manager_content`
- Site-level remote auth values are stored in:
  - `redstone_website_manager_site_key`
  - `redstone_website_manager_shared_secret`
- Last REST update time is stored in: `redstone_website_manager_content_updated_at`
- Frontend token replacement runs through output buffering on normal frontend page loads.
- On successful REST updates, the plugin flushes WordPress object cache and common page-cache integrations when available.
