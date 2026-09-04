package com.moyuyu.yuaiagentpro.palace;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "app.memory")
public class PalaceProperties {

    private String mode = "DEFAULT";
    private Palace palace = new Palace();

    @Getter
    @Setter
    public static class Palace {
        private boolean enabled = true;
        private int drawerLimit = 6;
        private int anchorLimit = 4;
        private int contextCharLimit = 1800;
        private boolean writeAsync = true;
        private boolean vectorEnabled = true;
    }
}
