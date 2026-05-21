package conn.uploader;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import app.lovable.cameraftp.CameraFtpPlugin;
import app.lovable.camerausb.CameraUsbPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CameraFtpPlugin.class);
        registerPlugin(CameraUsbPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
