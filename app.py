"""
Image Colorization Application - Flask Web Server
"""

import numpy as np
import cv2
import os
from flask import Flask, request, jsonify, render_template, send_file
from io import BytesIO
import onnxruntime as ort

# ====== Constants & File Paths ====== #
DEOLDIFY_MODEL_FILE = "models/deoldify-art.onnx"

# ====== Core DeOldify Logic ====== #
def colorize_deoldify_core(img, session):
    """Core colorization logic using ONNX runtime with improved color handling"""
    h, w = img.shape[:2]
    
    # Convert BGR to RGB
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    
    # Resize to 256x256 (DeOldify fixed shape)
    img_resized = cv2.resize(img_rgb, (256, 256))
    
    # Scale to [0, 1]
    img_scaled = img_resized.astype(np.float32) / 255.0
    
    # Normalize using ImageNet statistics
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    img_normalized = (img_scaled - mean) / std
    
    # Transpose to NCHW format
    img_tensor = np.transpose(img_normalized, (2, 0, 1))
    img_tensor = np.expand_dims(img_tensor, axis=0)

    # Run ONNX inference
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: img_tensor})
    output_tensor = outputs[0][0]

    # Postprocessing: transpose back to HWC
    output_tensor = np.transpose(output_tensor, (1, 2, 0))
    
    # Unnormalize
    colorized_rgb = output_tensor * std + mean
    colorized_rgb = np.clip(colorized_rgb, 0, 1)
    colorized_rgb = (colorized_rgb * 255).astype(np.uint8)

    # Use LAB color space merging to preserve high-resolution details
    original_lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    original_L = original_lab[:, :, 0]

    # Non-linear brightness enhancement of the Lightness (L) channel
    # A gentle gamma of 0.85 lifts shadows and midtones to reveal hidden details
    # while preserving natural contrast and depth of the historical photograph.
    original_L_float = original_L.astype(np.float32) / 255.0
    gamma = 0.85  # Universal power-law correction to lift dark regions naturally
    brightened_L = np.power(original_L_float, gamma) * 255.0
    brightened_L = np.clip(brightened_L, 0, 255).astype(np.uint8)

    colorized_bgr = cv2.cvtColor(colorized_rgb, cv2.COLOR_RGB2BGR)
    colorized_lab = cv2.cvtColor(colorized_bgr, cv2.COLOR_BGR2LAB)
    colorized_a = colorized_lab[:, :, 1]
    colorized_b = colorized_lab[:, :, 2]

    # Resize predicted channels back to original dimensions
    resized_a = cv2.resize(colorized_a, (w, h))
    resized_b = cv2.resize(colorized_b, (w, h))

    # Realistic Asymmetrical Color Tuning (LAB space)
    # Heavily suppresses DeOldify's natural blue/purple bias in shadows and grays (b < 128),
    # keeps green soft and natural (a < 128), and gently preserves warm skin/wood tones (a > 128, b > 128).
    def apply_realistic_color_tuning(channel_a, channel_b):
        da = channel_a.astype(np.float32) - 128.0
        db = channel_b.astype(np.float32) - 128.0
        
        # a channel: a > 0 is red (gently scale by 1.05x), a < 0 is green (damp by 60% to 0.40x)
        da_new = np.where(da > 0, da * 1.05, da * 0.40)
        
        # b channel: b > 0 is yellow (gently scale by 1.10x), b < 0 is blue (damp by 75% to 0.25x)
        db_new = np.where(db > 0, db * 1.10, db * 0.25)
        
        a_out = np.clip(da_new + 128.0, 0, 255).astype(np.uint8)
        b_out = np.clip(db_new + 128.0, 0, 255).astype(np.uint8)
        return a_out, b_out

    resized_a, resized_b = apply_realistic_color_tuning(resized_a, resized_b)

    # Recombine channels with brightened lightness
    final_lab = cv2.merge([brightened_L, resized_a, resized_b])
    final_bgr = cv2.cvtColor(final_lab, cv2.COLOR_LAB2BGR)
    final_bgr = np.clip(final_bgr, 0, 255).astype(np.uint8)
    
    return final_bgr

# ====== Flask Web Server Mode ====== #
def create_flask_app():
    """Create Flask application for web service"""

    app = Flask(__name__, template_folder='templates', static_folder='static')
    

    # Global session
    session_cache = {'session': None}

    def get_flask_session():
        """Get Flask ONNX session"""
        if session_cache['session'] is None:
            session_cache['session'] = ort.InferenceSession(DEOLDIFY_MODEL_FILE)
        return session_cache['session']

    @app.route('/')
    def index():
        return render_template('index.html')

    @app.route('/result')
    def result():
        return render_template('result.html')

    @app.route('/colorize', methods=['POST'])
    def colorize():
        if 'image' not in request.files:
            return jsonify({'error': 'No image file uploaded'}), 400
            
        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        try:
            file_bytes = np.frombuffer(file.read(), np.uint8)
            img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
            if img is None:
                return jsonify({'error': 'Could not decode image'}), 400

            sess = get_flask_session()
            colorized_bgr = colorize_deoldify_core(img, sess)

            is_success, buffer = cv2.imencode('.png', colorized_bgr)
            if not is_success:
                return jsonify({'error': 'Could not encode output image'}), 500

            img_io = BytesIO(buffer.tobytes())
            img_io.seek(0)
            
            return send_file(
                img_io, 
                mimetype='image/png', 
                as_attachment=True, 
                download_name='colorized_' + os.path.splitext(file.filename)[0] + '.png'
            )

        except Exception as e:
            print(f"[Server Error]: {e}")
            return jsonify({'error': str(e)}), 500

    return app

def run_flask_server():
    """Run Flask web server"""
    print("[Server]: Launching Flask Web Application on http://localhost:5001")
    app = create_flask_app()
    try:
        app.run(host='0.0.0.0', port=5001, debug=True)
    except Exception as e:
        print(f"[Server Error]: {e}")

# ====== Main Entry Point ====== #
if __name__ == "__main__":
    run_flask_server()