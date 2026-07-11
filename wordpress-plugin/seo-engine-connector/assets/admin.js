jQuery(document).ready(function($) {
    // Test connection button
    $('#sec-test-btn').on('click', function() {
        var $btn = $(this);
        var $result = $('#sec-test-result');

        $btn.prop('disabled', true).find('.dashicons').addClass('spin');
        $result.text('Test en cours...');

        $.ajax({
            url: secData.ajaxUrl,
            method: 'POST',
            data: {
                action: 'sec_test_connection',
                nonce: secData.nonce
            },
            success: function(response) {
                if (response.success) {
                    $result.css('color', '#065f46').text('✓ Connexion réussie — ' + response.data.message);
                } else {
                    $result.css('color', '#991b1b').text('✗ ' + (response.data || 'Erreur de connexion'));
                }
            },
            error: function() {
                $result.css('color', '#991b1b').text('✗ Erreur réseau');
            },
            complete: function() {
                $btn.prop('disabled', false).find('.dashicons').removeClass('spin');
            }
        });
    });

    // Refresh internal links button
    $('#sec-refresh-links').on('click', function() {
        var $btn = $(this);
        var $result = $('#sec-linking-result');

        $btn.prop('disabled', true);
        $result.html('<p>Rafraîchissement du maillage en cours...</p>');

        $.ajax({
            url: secData.ajaxUrl,
            method: 'POST',
            data: {
                action: 'sec_refresh_links',
                nonce: secData.nonce
            },
            success: function(response) {
                if (response.success) {
                    $result.html('<p style="color:#065f46;">✓ ' + response.data.message + '</p>');
                } else {
                    $result.html('<p style="color:#991b1b;">✗ ' + (response.data || 'Erreur') + '</p>');
                }
            },
            error: function() {
                $result.html('<p style="color:#991b1b;">✗ Erreur réseau</p>');
            },
            complete: function() {
                $btn.prop('disabled', false);
            }
        });
    });
});

// CSS animation for spin
var style = document.createElement('style');
style.textContent = '.dashicons.spin { animation: sec-spin 1s linear infinite; } @keyframes sec-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
document.head.appendChild(style);
