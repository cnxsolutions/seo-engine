<?php
/**
 * Plugin Name: SEO Engine Connector
 * Plugin URI: https://seo-engine.local
 * Description: Connexion bidirectionnelle avec SEO Engine — publication automatique de pages SEO, remontée d'analytics et synchronisation du maillage interne.
 * Version: 1.0.0
 * Author: SEO Engine
 * License: GPL v2 or later
 * Text Domain: seo-engine-connector
 */

if (!defined('ABSPATH')) exit;

define('SEC_VERSION', '1.0.0');
define('SEC_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('SEC_PLUGIN_URL', plugin_dir_url(__FILE__));

class SEO_Engine_Connector {
    private static $instance = null;
    private $api_key;
    private $engine_url;

    public static function instance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        $this->api_key = get_option('sec_api_key', '');
        $this->engine_url = get_option('sec_engine_url', '');

        add_action('admin_menu', [$this, 'admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('rest_api_init', [$this, 'register_rest_routes']);
        add_action('admin_enqueue_scripts', [$this, 'admin_assets']);
        add_action('wp_head', [$this, 'inject_tracking']);

        // Hook post publication for analytics sync
        add_action('transition_post_status', [$this, 'on_post_status_change'], 10, 3);
    }

    public function admin_menu() {
        add_menu_page(
            'SEO Engine',
            'SEO Engine',
            'manage_options',
            'seo-engine',
            [$this, 'render_dashboard'],
            'dashicons-chart-area',
            30
        );
        add_submenu_page('seo-engine', 'Connexion', 'Connexion', 'manage_options', 'seo-engine', [$this, 'render_dashboard']);
        add_submenu_page('seo-engine', 'Pages SEO', 'Pages SEO', 'manage_options', 'seo-engine-pages', [$this, 'render_pages']);
        add_submenu_page('seo-engine', 'Maillage', 'Maillage', 'manage_options', 'seo-engine-linking', [$this, 'render_linking']);
    }

    public function register_settings() {
        register_setting('sec_settings', 'sec_api_key');
        register_setting('sec_settings', 'sec_engine_url');
        register_setting('sec_settings', 'sec_auto_publish');
        register_setting('sec_settings', 'sec_default_status');
        register_setting('sec_settings', 'sec_sync_analytics');
        register_setting('sec_settings', 'sec_indexnow_key');
    }

    public function admin_assets($hook) {
        if (strpos($hook, 'seo-engine') === false) return;
        wp_enqueue_style('sec-admin', SEC_PLUGIN_URL . 'assets/admin.css', [], SEC_VERSION);
        wp_enqueue_script('sec-admin', SEC_PLUGIN_URL . 'assets/admin.js', ['jquery'], SEC_VERSION, true);
        wp_localize_script('sec-admin', 'secData', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('sec_nonce'),
            'engineUrl' => $this->engine_url,
        ]);
    }

    /**
     * REST API endpoints for bidirectional communication
     */
    public function register_rest_routes() {
        register_rest_route('seo-engine/v1', '/publish', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_publish_page'],
            'permission_callback' => [$this, 'verify_api_key'],
        ]);

        register_rest_route('seo-engine/v1', '/status', [
            'methods' => 'GET',
            'callback' => [$this, 'rest_status'],
            'permission_callback' => [$this, 'verify_api_key'],
        ]);

        register_rest_route('seo-engine/v1', '/pages', [
            'methods' => 'GET',
            'callback' => [$this, 'rest_list_pages'],
            'permission_callback' => [$this, 'verify_api_key'],
        ]);

        register_rest_route('seo-engine/v1', '/analytics', [
            'methods' => 'GET',
            'callback' => [$this, 'rest_analytics'],
            'permission_callback' => [$this, 'verify_api_key'],
        ]);

        register_rest_route('seo-engine/v1', '/internal-links', [
            'methods' => 'POST',
            'callback' => [$this, 'rest_update_internal_links'],
            'permission_callback' => [$this, 'verify_api_key'],
        ]);
    }

    public function verify_api_key($request) {
        $key = $request->get_header('X-SEO-Engine-Key');
        if (!$key) {
            $key = $request->get_param('api_key');
        }
        return $key && $key === $this->api_key;
    }

    /**
     * Publish a page from SEO Engine
     */
    public function rest_publish_page($request) {
        $params = $request->get_json_params();

        $title = sanitize_text_field($params['title'] ?? '');
        $content = wp_kses_post($params['content'] ?? '');
        $slug = sanitize_title($params['slug'] ?? '');
        $status = sanitize_text_field($params['status'] ?? get_option('sec_default_status', 'draft'));
        $meta = $params['meta'] ?? [];
        $page_type = sanitize_text_field($params['page_type'] ?? 'child');
        $parent_slug = sanitize_text_field($params['parent_slug'] ?? '');

        if (!$title || !$content) {
            return new \WP_Error('missing_data', 'Title and content are required', ['status' => 400]);
        }

        // Find parent page if specified
        $parent_id = 0;
        if ($parent_slug) {
            $parent = get_page_by_path($parent_slug);
            if ($parent) $parent_id = $parent->ID;
        }

        $page_data = [
            'post_title' => $title,
            'post_content' => $content,
            'post_name' => $slug,
            'post_status' => $status,
            'post_type' => 'page',
            'post_parent' => $parent_id,
        ];

        // Check if page already exists (by slug)
        $existing = get_page_by_path($slug);
        if ($existing) {
            $page_data['ID'] = $existing->ID;
            $page_id = wp_update_post($page_data);
        } else {
            $page_id = wp_insert_post($page_data);
        }

        if (is_wp_error($page_id)) {
            return new \WP_Error('create_failed', $page_id->get_error_message(), ['status' => 500]);
        }

        // Set SEO meta (RankMath compatible)
        if (!empty($meta)) {
            foreach ($meta as $key => $value) {
                update_post_meta($page_id, $key, $value);
            }
        }

        // Store SEO Engine metadata
        update_post_meta($page_id, '_seo_engine_managed', '1');
        update_post_meta($page_id, '_seo_engine_page_type', $page_type);
        update_post_meta($page_id, '_seo_engine_last_sync', current_time('mysql'));

        return [
            'success' => true,
            'page_id' => $page_id,
            'page_url' => get_permalink($page_id),
            'edit_url' => get_edit_post_link($page_id, 'raw'),
        ];
    }

    /**
     * Get site status and connection info
     */
    public function rest_status($request) {
        $managed_pages = get_posts([
            'post_type' => 'page',
            'meta_key' => '_seo_engine_managed',
            'meta_value' => '1',
            'posts_per_page' => -1,
            'fields' => 'ids',
        ]);

        return [
            'connected' => true,
            'site_name' => get_bloginfo('name'),
            'site_url' => home_url(),
            'wordpress_version' => get_bloginfo('version'),
            'plugin_version' => SEC_VERSION,
            'managed_pages' => count($managed_pages),
            'rankmath_active' => is_plugin_active('seo-by-rank-math/rank-math.php'),
            'php_version' => phpversion(),
        ];
    }

    /**
     * List all SEO Engine managed pages
     */
    public function rest_list_pages($request) {
        $pages = get_posts([
            'post_type' => 'page',
            'meta_key' => '_seo_engine_managed',
            'meta_value' => '1',
            'posts_per_page' => 100,
            'orderby' => 'date',
            'order' => 'DESC',
        ]);

        $result = [];
        foreach ($pages as $page) {
            $result[] = [
                'id' => $page->ID,
                'title' => $page->post_title,
                'slug' => $page->post_name,
                'url' => get_permalink($page->ID),
                'status' => $page->post_status,
                'page_type' => get_post_meta($page->ID, '_seo_engine_page_type', true),
                'parent_id' => $page->post_parent,
                'last_sync' => get_post_meta($page->ID, '_seo_engine_last_sync', true),
                'published_at' => $page->post_date,
                'modified_at' => $page->post_modified,
            ];
        }

        return ['pages' => $result, 'total' => count($result)];
    }

    /**
     * Get basic analytics for managed pages
     */
    public function rest_analytics($request) {
        $pages = get_posts([
            'post_type' => 'page',
            'meta_key' => '_seo_engine_managed',
            'meta_value' => '1',
            'posts_per_page' => -1,
        ]);

        $analytics = [];
        foreach ($pages as $page) {
            $views = (int) get_post_meta($page->ID, '_sec_page_views', true);
            $analytics[] = [
                'page_id' => $page->ID,
                'slug' => $page->post_name,
                'title' => $page->post_title,
                'views' => $views,
                'status' => $page->post_status,
                'word_count' => str_word_count(strip_tags($page->post_content)),
            ];
        }

        return ['analytics' => $analytics];
    }

    /**
     * Update internal links between pages
     */
    public function rest_update_internal_links($request) {
        $params = $request->get_json_params();
        $links = $params['links'] ?? [];
        $updated = 0;

        foreach ($links as $link_data) {
            $page_id = intval($link_data['page_id'] ?? 0);
            $links_to_add = $link_data['links'] ?? [];

            if (!$page_id || empty($links_to_add)) continue;

            $page = get_post($page_id);
            if (!$page) continue;

            $content = $page->post_content;
            $modified = false;

            foreach ($links_to_add as $link) {
                $anchor = $link['anchor'] ?? '';
                $href = $link['href'] ?? '';
                if (!$anchor || !$href) continue;

                // Only inject if anchor text exists in content and isn't already linked
                if (strpos($content, $anchor) !== false && strpos($content, ">{$anchor}</a>") === false) {
                    $content = preg_replace(
                        '/(' . preg_quote($anchor, '/') . ')(?![^<]*<\/a>)/i',
                        '<a href="' . esc_url($href) . '">$1</a>',
                        $content,
                        1
                    );
                    $modified = true;
                }
            }

            if ($modified) {
                wp_update_post(['ID' => $page_id, 'post_content' => $content]);
                $updated++;
            }
        }

        return ['success' => true, 'updated_pages' => $updated];
    }

    /**
     * Track post status changes for managed pages
     */
    public function on_post_status_change($new_status, $old_status, $post) {
        if ($post->post_type !== 'page') return;
        $managed = get_post_meta($post->ID, '_seo_engine_managed', true);
        if ($managed !== '1') return;

        if ($new_status === 'publish' && $old_status !== 'publish') {
            update_post_meta($post->ID, '_seo_engine_published_at', current_time('mysql'));
            $this->notify_engine('page_published', [
                'page_id' => $post->ID,
                'slug' => $post->post_name,
                'url' => get_permalink($post->ID),
            ]);
            $this->submit_indexnow(get_permalink($post->ID));
        }
    }

    /**
     * Submit URL to IndexNow directly from WordPress
     */
    private function submit_indexnow($url) {
        $key = get_option('sec_indexnow_key', '');
        if (!$key) return;

        $host = wp_parse_url(home_url(), PHP_URL_HOST);
        wp_remote_post('https://api.indexnow.org/indexnow', [
            'body' => json_encode([
                'host' => $host,
                'key' => $key,
                'keyLocation' => home_url("/{$key}.txt"),
                'urlList' => [$url],
            ]),
            'headers' => ['Content-Type' => 'application/json'],
            'timeout' => 10,
            'blocking' => false,
        ]);
    }

    /**
     * Notify the SEO Engine server about events
     */
    private function notify_engine($event, $data) {
        if (!$this->engine_url || !$this->api_key) return;

        wp_remote_post(rtrim($this->engine_url, '/') . '/api/webhook/wordpress', [
            'body' => json_encode(['event' => $event, 'data' => $data, 'site_url' => home_url()]),
            'headers' => [
                'Content-Type' => 'application/json',
                'X-SEO-Engine-Key' => $this->api_key,
            ],
            'timeout' => 5,
            'blocking' => false,
        ]);
    }

    /**
     * Inject tracking pixel for page views
     */
    public function inject_tracking() {
        if (!is_page()) return;
        $managed = get_post_meta(get_the_ID(), '_seo_engine_managed', true);
        if ($managed !== '1') return;

        echo '<script>
        (function(){
            fetch("' . esc_url(rest_url('seo-engine/v1/track')) . '", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({page_id: ' . get_the_ID() . '})
            }).catch(function(){});
        })();
        </script>';
    }

    /**
     * Dashboard page
     */
    public function render_dashboard() {
        $connected = !empty($this->api_key) && !empty($this->engine_url);
        ?>
        <div class="wrap sec-wrap">
            <h1><span class="dashicons dashicons-chart-area"></span> SEO Engine Connector</h1>

            <div class="sec-status-card <?php echo $connected ? 'connected' : 'disconnected'; ?>">
                <div class="sec-status-indicator"></div>
                <span><?php echo $connected ? 'Connecté à SEO Engine' : 'Non connecté'; ?></span>
            </div>

            <form method="post" action="options.php">
                <?php settings_fields('sec_settings'); ?>
                <table class="form-table">
                    <tr>
                        <th>URL SEO Engine</th>
                        <td><input type="url" name="sec_engine_url" value="<?php echo esc_attr($this->engine_url); ?>" class="regular-text" placeholder="https://seo-engine.example.com" /></td>
                    </tr>
                    <tr>
                        <th>Clé API</th>
                        <td><input type="password" name="sec_api_key" value="<?php echo esc_attr($this->api_key); ?>" class="regular-text" /></td>
                    </tr>
                    <tr>
                        <th>Publication par défaut</th>
                        <td>
                            <select name="sec_default_status">
                                <option value="draft" <?php selected(get_option('sec_default_status'), 'draft'); ?>>Brouillon</option>
                                <option value="pending" <?php selected(get_option('sec_default_status'), 'pending'); ?>>En attente</option>
                                <option value="publish" <?php selected(get_option('sec_default_status'), 'publish'); ?>>Publié</option>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th>Clé IndexNow</th>
                        <td>
                            <input type="text" name="sec_indexnow_key" value="<?php echo esc_attr(get_option('sec_indexnow_key', '')); ?>" class="regular-text" placeholder="votre-cle-indexnow" />
                            <p class="description">Ping automatique IndexNow (Bing/Yandex) à chaque publication. <a href="https://www.indexnow.org/" target="_blank">Obtenir une clé</a></p>
                        </td>
                    </tr>
                    <tr>
                        <th>Sync Analytics</th>
                        <td><label><input type="checkbox" name="sec_sync_analytics" value="1" <?php checked(get_option('sec_sync_analytics'), '1'); ?> /> Remonter les statistiques de pages vers SEO Engine</label></td>
                    </tr>
                </table>
                <?php submit_button('Sauvegarder la connexion'); ?>
            </form>

            <?php if ($connected): ?>
            <div class="sec-test-connection">
                <button type="button" class="button button-secondary" id="sec-test-btn">
                    <span class="dashicons dashicons-update"></span> Tester la connexion
                </button>
                <span id="sec-test-result"></span>
            </div>
            <?php endif; ?>
        </div>
        <?php
    }

    public function render_pages() {
        $pages = get_posts([
            'post_type' => 'page',
            'meta_key' => '_seo_engine_managed',
            'meta_value' => '1',
            'posts_per_page' => 50,
            'orderby' => 'date',
            'order' => 'DESC',
        ]);
        ?>
        <div class="wrap sec-wrap">
            <h1>Pages gérées par SEO Engine</h1>
            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th>Titre</th>
                        <th>Type</th>
                        <th>Statut</th>
                        <th>Dernière sync</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($pages as $page):
                    $page_type = get_post_meta($page->ID, '_seo_engine_page_type', true);
                    $last_sync = get_post_meta($page->ID, '_seo_engine_last_sync', true);
                ?>
                    <tr>
                        <td><a href="<?php echo get_edit_post_link($page->ID); ?>"><?php echo esc_html($page->post_title); ?></a></td>
                        <td><span class="sec-badge sec-badge-<?php echo esc_attr($page_type); ?>"><?php echo esc_html(ucfirst($page_type)); ?></span></td>
                        <td><?php echo esc_html($page->post_status); ?></td>
                        <td><?php echo $last_sync ? esc_html($last_sync) : '—'; ?></td>
                        <td><a href="<?php echo get_permalink($page->ID); ?>" target="_blank">Voir</a></td>
                    </tr>
                <?php endforeach; ?>
                <?php if (empty($pages)): ?>
                    <tr><td colspan="5" style="text-align:center;padding:2em;">Aucune page gérée par SEO Engine.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    public function render_linking() {
        ?>
        <div class="wrap sec-wrap">
            <h1>Maillage interne</h1>
            <p>Le maillage interne entre les pages gérées par SEO Engine est automatiquement mis à jour lors de la publication.</p>
            <button type="button" class="button button-primary" id="sec-refresh-links">
                <span class="dashicons dashicons-admin-links"></span> Rafraîchir le maillage
            </button>
            <div id="sec-linking-result" style="margin-top:1em;"></div>
        </div>
        <?php
    }
}

// Initialize
add_action('plugins_loaded', function() {
    SEO_Engine_Connector::instance();
});

// Activation hook
register_activation_hook(__FILE__, function() {
    add_option('sec_api_key', '');
    add_option('sec_engine_url', '');
    add_option('sec_default_status', 'draft');
    add_option('sec_sync_analytics', '0');
    flush_rewrite_rules();
});

// Deactivation hook
register_deactivation_hook(__FILE__, function() {
    flush_rewrite_rules();
});
