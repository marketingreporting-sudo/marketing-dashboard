<?php
/**
 * Plugin Name: Redstone Website Manager
 * Plugin URI: https://redstone.example
 * Description: Stores editable website content fields for Redstone-managed WordPress properties and exposes them to themes plus a secure REST endpoint.
 * Version: 0.1.0
 * Author: Redstone
 * License: GPL-2.0-or-later
 * Text Domain: redstone-website-manager
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('Redstone_Website_Manager')) {
    final class Redstone_Website_Manager {
        const OPTION_KEY = 'redstone_website_manager_content';
        const MENU_SLUG = 'redstone-website-manager';
        const REST_NAMESPACE = 'redstone-site-manager/v1';
        const TOKEN_PREFIX = 'rwm:';
        const SITE_KEY_OPTION = 'redstone_website_manager_site_key';
        const SHARED_SECRET_OPTION = 'redstone_website_manager_shared_secret';
        const SIGNATURE_WINDOW_SECONDS = 900;

        /**
         * @var array<string, array<string, string>>
         */
        private $field_schema = array(
            'site_identity' => array(
                'title' => 'Site Identity',
                'description' => 'Used for editor context and optional token replacements.',
                'fields' => array(
                    'property_name' => array(
                        'label' => 'Property Name',
                        'type' => 'text',
                        'help' => 'Example: The Station at Mill Race',
                    ),
                ),
            ),
            'homepage_hero' => array(
                'title' => 'Homepage Hero',
                'description' => 'Primary homepage messaging fields.',
                'fields' => array(
                    'hero_headline' => array(
                        'label' => 'Headline',
                        'type' => 'textarea',
                        'help' => 'Main homepage headline.',
                    ),
                    'hero_subtitle' => array(
                        'label' => 'Subtitle',
                        'type' => 'textarea',
                        'help' => 'Supporting subheadline or descriptive copy.',
                    ),
                    'primary_cta_label' => array(
                        'label' => 'Primary CTA Label',
                        'type' => 'text',
                        'help' => 'Example: Schedule a Tour',
                    ),
                    'primary_cta_url' => array(
                        'label' => 'Primary CTA URL',
                        'type' => 'url',
                        'help' => 'Relative or absolute URL.',
                    ),
                    'secondary_cta_label' => array(
                        'label' => 'Secondary CTA Label',
                        'type' => 'text',
                        'help' => 'Example: View Availability',
                    ),
                    'secondary_cta_url' => array(
                        'label' => 'Secondary CTA URL',
                        'type' => 'url',
                        'help' => 'Relative or absolute URL.',
                    ),
                ),
            ),
            'top_banner' => array(
                'title' => 'Top Banner',
                'description' => 'Promo banner content that can appear near the top of the homepage.',
                'fields' => array(
                    'banner_eyebrow' => array(
                        'label' => 'Banner Eyebrow',
                        'type' => 'text',
                        'help' => 'Short supporting label above the main banner headline.',
                    ),
                    'banner_headline' => array(
                        'label' => 'Banner Headline',
                        'type' => 'textarea',
                        'help' => 'Headline-sized promo message or offer.',
                    ),
                    'banner_body' => array(
                        'label' => 'Banner Body',
                        'type' => 'textarea',
                        'help' => 'Short supporting copy for the banner.',
                    ),
                ),
            ),
            'floorplans_banner' => array(
                'title' => 'Floor Plans Banner',
                'description' => 'Messaging block for the floor plans page.',
                'fields' => array(
                    'floorplans_headline' => array(
                        'label' => 'Section Headline',
                        'type' => 'textarea',
                        'help' => 'Floor plans page headline.',
                    ),
                    'floorplans_body' => array(
                        'label' => 'Section Body',
                        'type' => 'textarea',
                        'help' => 'Supporting copy for the floor plans section.',
                    ),
                ),
            ),
            'availability' => array(
                'title' => 'Availability',
                'description' => 'Manual note plus auto-filled live availability fields from Redstone.',
                'fields' => array(
                    'availability_note' => array(
                        'label' => 'Availability Note',
                        'type' => 'textarea',
                        'help' => 'Fine print or disclaimer shown near live pricing/availability.',
                    ),
                    'pricing_summary' => array(
                        'label' => 'Pricing Summary',
                        'type' => 'textarea',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                    'availability_summary' => array(
                        'label' => 'Availability Summary',
                        'type' => 'textarea',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                    'specials_summary' => array(
                        'label' => 'Specials Summary',
                        'type' => 'textarea',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                    'availability_url' => array(
                        'label' => 'Availability URL',
                        'type' => 'url',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                    'starting_price' => array(
                        'label' => 'Starting Price',
                        'type' => 'text',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                    'price_range' => array(
                        'label' => 'Price Range',
                        'type' => 'text',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                    'specials_count' => array(
                        'label' => 'Specials Count',
                        'type' => 'text',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                    'floorplan_count' => array(
                        'label' => 'Floorplan Count',
                        'type' => 'text',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                    'available_unit_count' => array(
                        'label' => 'Available Unit Count',
                        'type' => 'text',
                        'help' => 'Auto-filled by the Redstone dashboard.',
                    ),
                ),
            ),
        );

        public function __construct() {
            add_action('admin_menu', array($this, 'register_admin_page'));
            add_action('admin_init', array($this, 'register_setting'));
            add_action('rest_api_init', array($this, 'register_rest_routes'));
            add_action('template_redirect', array($this, 'start_frontend_buffer'));
        }

        public function register_admin_page() {
            add_options_page(
                'Redstone Website Manager',
                'Redstone Website Manager',
                'manage_options',
                self::MENU_SLUG,
                array($this, 'render_admin_page')
            );
        }

        public function register_setting() {
            register_setting(
                self::MENU_SLUG,
                self::OPTION_KEY,
                array(
                    'type' => 'object',
                    'sanitize_callback' => array($this, 'sanitize_payload'),
                    'default' => $this->get_default_values(),
                    'show_in_rest' => false,
                )
            );
            register_setting(
                self::MENU_SLUG,
                self::SITE_KEY_OPTION,
                array(
                    'type' => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                    'default' => '',
                    'show_in_rest' => false,
                )
            );
            register_setting(
                self::MENU_SLUG,
                self::SHARED_SECRET_OPTION,
                array(
                    'type' => 'string',
                    'sanitize_callback' => array($this, 'sanitize_secret'),
                    'default' => '',
                    'show_in_rest' => false,
                )
            );
        }

        public function register_rest_routes() {
            register_rest_route(
                self::REST_NAMESPACE,
                '/content',
                array(
                    array(
                        'methods' => WP_REST_Server::READABLE,
                        'callback' => array($this, 'handle_rest_get'),
                        'permission_callback' => '__return_true',
                    ),
                    array(
                        'methods' => WP_REST_Server::EDITABLE,
                        'callback' => array($this, 'handle_rest_update'),
                        'permission_callback' => '__return_true',
                    ),
                )
            );
        }

        public function sanitize_secret($value) {
            return trim(is_scalar($value) ? (string) $value : '');
        }

        public function handle_rest_get(WP_REST_Request $request) {
            return rest_ensure_response(
                array(
                    'content' => $this->get_content(),
                    'schema' => $this->get_flat_schema(),
                    'updated_at' => get_option(self::OPTION_KEY . '_updated_at'),
                )
            );
        }

        public function handle_rest_update(WP_REST_Request $request) {
            if (!$this->request_can_manage($request)) {
                return new WP_Error(
                    'redstone_forbidden',
                    'This request is not authorized to update website content.',
                    array('status' => 403)
                );
            }

            $payload = $request->get_json_params();
            if (!is_array($payload)) {
                return new WP_Error(
                    'redstone_invalid_payload',
                    'JSON body must be an object.',
                    array('status' => 400)
                );
            }

            $normalized = $this->sanitize_payload($payload);
            update_option(self::OPTION_KEY, $normalized, false);
            update_option(self::OPTION_KEY . '_updated_at', current_time('mysql'), false);
            $this->flush_common_caches();

            return rest_ensure_response(
                array(
                    'success' => true,
                    'content' => $normalized,
                    'updated_at' => get_option(self::OPTION_KEY . '_updated_at'),
                )
            );
        }

        private function request_can_manage(WP_REST_Request $request) {
            if (current_user_can('manage_options')) {
                return true;
            }

            return $this->verify_service_signature($request);
        }

        private function verify_service_signature(WP_REST_Request $request) {
            $configured_site_key = $this->get_configured_site_key();
            $shared_secret = $this->get_shared_secret();
            $provided_site_key = trim((string) $request->get_header('x-redstone-site-key'));
            $timestamp = trim((string) $request->get_header('x-redstone-timestamp'));
            $signature = trim((string) $request->get_header('x-redstone-signature'));

            if ($configured_site_key === '' || $shared_secret === '' || $provided_site_key === '' || $timestamp === '' || $signature === '') {
                return false;
            }

            if (!hash_equals($configured_site_key, $provided_site_key)) {
                return false;
            }

            if (!ctype_digit($timestamp)) {
                return false;
            }

            $timestamp_int = (int) $timestamp;
            if (abs(time() - $timestamp_int) > self::SIGNATURE_WINDOW_SECONDS) {
                return false;
            }

            $body = (string) $request->get_body();
            $expected = hash_hmac('sha256', $timestamp . "\n" . $provided_site_key . "\n" . $body, $shared_secret);

            return hash_equals($expected, $signature);
        }

        private function get_configured_site_key() {
            return trim((string) get_option(self::SITE_KEY_OPTION, ''));
        }

        private function get_shared_secret() {
            return trim((string) get_option(self::SHARED_SECRET_OPTION, ''));
        }

        private function flush_common_caches() {
            if (function_exists('wp_cache_flush')) {
                wp_cache_flush();
            }
            if (function_exists('rocket_clean_domain')) {
                rocket_clean_domain();
            }
            if (function_exists('w3tc_flush_all')) {
                w3tc_flush_all();
            }
            if (function_exists('wpfc_clear_all_cache')) {
                wpfc_clear_all_cache(true);
            }
            if (function_exists('litespeed_purge_all')) {
                litespeed_purge_all();
            }
            if (function_exists('sg_cachepress_purge_everything')) {
                sg_cachepress_purge_everything();
            }
            do_action('redstone_website_manager_cache_flushed');
        }

        /**
         * @param mixed $value
         * @return array<string, string>
         */
        public function sanitize_payload($value) {
            $input = is_array($value) ? $value : array();
            $sanitized = $this->get_default_values();

            foreach ($this->field_schema as $section) {
                foreach ($section['fields'] as $key => $field) {
                    $raw = isset($input[$key]) ? $input[$key] : '';
                    $sanitized[$key] = $this->sanitize_field_value($field['type'], $raw);
                }
            }

            return $sanitized;
        }

        /**
         * @param mixed $value
         * @return string
         */
        private function sanitize_field_value($type, $value) {
            $value = is_scalar($value) ? (string) $value : '';

            if ($type === 'url') {
                if ($value === '') {
                    return '';
                }

                if (strpos($value, '/') === 0) {
                    return esc_url_raw(home_url($value));
                }

                return esc_url_raw($value);
            }

            if ($type === 'textarea') {
                return sanitize_textarea_field($value);
            }

            return sanitize_text_field($value);
        }

        /**
         * @return array<string, string>
         */
        public function get_default_values() {
            $defaults = array();

            foreach ($this->field_schema as $section) {
                foreach ($section['fields'] as $key => $field) {
                    $defaults[$key] = '';
                }
            }

            return $defaults;
        }

        /**
         * @return array<string, string>
         */
        public function get_content() {
            $stored = get_option(self::OPTION_KEY, array());
            if (!is_array($stored)) {
                $stored = array();
            }

            return wp_parse_args($stored, $this->get_default_values());
        }

        /**
         * @return array<string, array<string, string>>
         */
        public function get_schema() {
            return $this->field_schema;
        }

        /**
         * @return array<string, array<string, string>>
         */
        public function get_flat_schema() {
            $flat = array();

            foreach ($this->field_schema as $section_key => $section) {
                foreach ($section['fields'] as $field_key => $field) {
                    $flat[$field_key] = array(
                        'section' => $section_key,
                        'section_title' => $section['title'],
                        'label' => $field['label'],
                        'type' => $field['type'],
                        'help' => $field['help'],
                    );
                }
            }

            return $flat;
        }

        public function render_admin_page() {
            if (!current_user_can('manage_options')) {
                return;
            }

            $content = $this->get_content();
            ?>
            <div class="wrap">
                <h1>Redstone Website Manager</h1>
                <p>Use this screen as the single source of truth for property marketing copy that can be driven from the Redstone dashboard later.</p>

                <form method="post" action="options.php">
                    <?php settings_fields(self::MENU_SLUG); ?>

                    <h2>Remote Sync Authentication</h2>
                    <table class="form-table" role="presentation">
                        <tbody>
                            <tr>
                                <th scope="row">
                                    <label for="<?php echo esc_attr(self::SITE_KEY_OPTION); ?>">Site Key</label>
                                </th>
                                <td>
                                    <input
                                        class="regular-text"
                                        type="text"
                                        id="<?php echo esc_attr(self::SITE_KEY_OPTION); ?>"
                                        name="<?php echo esc_attr(self::SITE_KEY_OPTION); ?>"
                                        value="<?php echo esc_attr($this->get_configured_site_key()); ?>"
                                    />
                                    <p class="description">Must match the WordPress site key saved in the Redstone dashboard.</p>
                                </td>
                            </tr>
                            <tr>
                                <th scope="row">
                                    <label for="<?php echo esc_attr(self::SHARED_SECRET_OPTION); ?>">Shared Secret</label>
                                </th>
                                <td>
                                    <input
                                        class="regular-text"
                                        type="password"
                                        id="<?php echo esc_attr(self::SHARED_SECRET_OPTION); ?>"
                                        name="<?php echo esc_attr(self::SHARED_SECRET_OPTION); ?>"
                                        value="<?php echo esc_attr($this->get_shared_secret()); ?>"
                                        autocomplete="new-password"
                                    />
                                    <p class="description">Configure the same secret in Render via <code>WORDPRESS_SITE_SECRETS_JSON</code>.</p>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <table class="form-table" role="presentation">
                        <tbody>
                        <?php foreach ($this->field_schema as $section_key => $section) : ?>
                            <tr>
                                <th colspan="2" style="padding-top: 24px;">
                                    <h2 style="margin: 0;"><?php echo esc_html($section['title']); ?></h2>
                                    <p style="margin: 6px 0 0;"><?php echo esc_html($section['description']); ?></p>
                                </th>
                            </tr>
                            <?php foreach ($section['fields'] as $field_key => $field) : ?>
                                <tr>
                                    <th scope="row">
                                        <label for="<?php echo esc_attr($field_key); ?>">
                                            <?php echo esc_html($field['label']); ?>
                                        </label>
                                    </th>
                                    <td>
                                        <?php if ($field['type'] === 'textarea') : ?>
                                            <textarea
                                                class="large-text"
                                                rows="4"
                                                id="<?php echo esc_attr($field_key); ?>"
                                                name="<?php echo esc_attr(self::OPTION_KEY . '[' . $field_key . ']'); ?>"
                                            ><?php echo esc_textarea($content[$field_key]); ?></textarea>
                                        <?php else : ?>
                                            <input
                                                class="regular-text"
                                                type="<?php echo esc_attr($field['type'] === 'url' ? 'url' : 'text'); ?>"
                                                id="<?php echo esc_attr($field_key); ?>"
                                                name="<?php echo esc_attr(self::OPTION_KEY . '[' . $field_key . ']'); ?>"
                                                value="<?php echo esc_attr($content[$field_key]); ?>"
                                            />
                                        <?php endif; ?>
                                        <p class="description">
                                            <code><?php echo esc_html($field_key); ?></code>
                                            <?php if (!empty($field['help'])) : ?>
                                                &mdash; <?php echo esc_html($field['help']); ?>
                                            <?php endif; ?>
                                        </p>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        <?php endforeach; ?>
                        </tbody>
                    </table>

                    <?php submit_button('Save Website Content'); ?>
                </form>

                <hr />
                <h2>Token Format</h2>
                <p>Use tokens like <code>{{rwm:hero_headline}}</code> inside Salient text blocks or link fields. The plugin replaces them in final frontend HTML, including <code>href</code>, <code>src</code>, and <code>action</code> attributes.</p>

                <hr />
                <h2>Theme Usage</h2>
                <p>Use <code>redstone_website_manager_get('hero_headline')</code> anywhere in the theme. The REST endpoint is <code>/wp-json/<?php echo esc_html(self::REST_NAMESPACE); ?>/content</code>.</p>
            </div>
            <?php
        }

        public function start_frontend_buffer() {
            if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
                return;
            }

            ob_start(array($this, 'replace_tokens_in_html'));
        }

        /**
         * @param string $html
         * @return string
         */
        public function replace_tokens_in_html($html) {
            if (!is_string($html) || strpos($html, '{{' . self::TOKEN_PREFIX) === false) {
                return $html;
            }

            $content = $this->get_content();

            $html = preg_replace_callback(
                '/\b(href|src|action)=([\'"])\{\{\s*' . preg_quote(self::TOKEN_PREFIX, '/') . '([a-z0-9_]+)\s*\}\}\2/i',
                function ($matches) use ($content) {
                    $attribute = strtolower($matches[1]);
                    $quote = $matches[2];
                    $key = $matches[3];
                    $value = isset($content[$key]) ? $content[$key] : '';

                    return sprintf(
                        '%1$s=%2$s%3$s%2$s',
                        $attribute,
                        $quote,
                        esc_url($value)
                    );
                },
                $html
            );

            $html = preg_replace_callback(
                '/\{\{\s*' . preg_quote(self::TOKEN_PREFIX, '/') . '([a-z0-9_]+)\s*\}\}/i',
                function ($matches) use ($content) {
                    $key = $matches[1];
                    $value = isset($content[$key]) ? $content[$key] : '';
                    return esc_html($value);
                },
                $html
            );

            return $html;
        }
    }
}

$GLOBALS['redstone_website_manager'] = new Redstone_Website_Manager();

if (!function_exists('redstone_website_manager_content')) {
    /**
     * @return array<string, string>
     */
    function redstone_website_manager_content() {
        $plugin = isset($GLOBALS['redstone_website_manager']) ? $GLOBALS['redstone_website_manager'] : null;
        if (!$plugin instanceof Redstone_Website_Manager) {
            return array();
        }

        return $plugin->get_content();
    }
}

if (!function_exists('redstone_website_manager_get')) {
    /**
     * @param string $key
     * @param string $default
     * @return string
     */
    function redstone_website_manager_get($key, $default = '') {
        $content = redstone_website_manager_content();
        return isset($content[$key]) && $content[$key] !== '' ? $content[$key] : $default;
    }
}

if (!function_exists('redstone_website_manager_has')) {
    /**
     * @param string $key
     * @return bool
     */
    function redstone_website_manager_has($key) {
        return redstone_website_manager_get($key, '') !== '';
    }
}

if (!function_exists('redstone_website_manager_get_url')) {
    /**
     * @param string $key
     * @param string $default
     * @return string
     */
    function redstone_website_manager_get_url($key, $default = '') {
        $value = redstone_website_manager_get($key, $default);
        return $value !== '' ? esc_url($value) : '';
    }
}

if (!function_exists('redstone_website_manager_echo')) {
    /**
     * @param string $key
     * @param string $mode
     * @param string $default
     * @return void
     */
    function redstone_website_manager_echo($key, $mode = 'text', $default = '') {
        $value = redstone_website_manager_get($key, $default);
        if ($mode === 'url') {
            echo esc_url($value);
            return;
        }
        if ($mode === 'raw') {
            echo wp_kses_post($value);
            return;
        }
        echo esc_html($value);
    }
}

if (!function_exists('redstone_website_manager_shortcode')) {
    /**
     * @param array<string, string> $atts
     * @return string
     */
    function redstone_website_manager_shortcode($atts) {
        $atts = shortcode_atts(
            array(
                'key' => '',
                'default' => '',
                'mode' => 'text',
            ),
            $atts,
            'redstone_site_content'
        );

        if ($atts['key'] === '') {
            return '';
        }

        $value = redstone_website_manager_get($atts['key'], $atts['default']);
        if ($value === '') {
            return '';
        }

        if ($atts['mode'] === 'url') {
            return esc_url($value);
        }

        if ($atts['mode'] === 'raw') {
            return wp_kses_post($value);
        }

        return esc_html($value);
    }

    add_shortcode('redstone_site_content', 'redstone_website_manager_shortcode');
}

if (!function_exists('redstone_website_manager_button_shortcode')) {
    /**
     * @param array<string, string> $atts
     * @param string|null $content
     * @return string
     */
    function redstone_website_manager_button_shortcode($atts, $content = null) {
        $atts = shortcode_atts(
            array(
                'label_key' => '',
                'url_key' => '',
                'label_default' => '',
                'url_default' => '',
                'class' => 'nectar-button medium regular accent-color regular-button',
                'target' => '_self',
                'rel' => '',
            ),
            $atts,
            'redstone_site_button'
        );

        $label = $atts['label_key'] !== ''
            ? redstone_website_manager_get($atts['label_key'], $atts['label_default'])
            : '';
        $url = $atts['url_key'] !== ''
            ? redstone_website_manager_get_url($atts['url_key'], $atts['url_default'])
            : '';

        if ($content !== null && trim($content) !== '') {
            $label = $content;
        }

        if ($label === '' || $url === '') {
            return '';
        }

        $rel = trim($atts['rel']);
        if ($atts['target'] === '_blank' && $rel === '') {
            $rel = 'noopener noreferrer';
        }

        return sprintf(
            '<a class="%1$s" href="%2$s" target="%3$s"%4$s>%5$s</a>',
            esc_attr($atts['class']),
            esc_url($url),
            esc_attr($atts['target']),
            $rel !== '' ? ' rel="' . esc_attr($rel) . '"' : '',
            esc_html($label)
        );
    }

    add_shortcode('redstone_site_button', 'redstone_website_manager_button_shortcode');
}
